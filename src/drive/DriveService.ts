import * as fs from 'fs';
import * as path from 'path';
import {
  UploadedDriveFile,
  DriveFolder,
  UploadFileOptions,
  BatchUploadOptions,
  DriveApiFileResource,
  DriveFileListResponse,
} from './types.js';
import { DriveApiError, friendlyHttpError } from '../errors/errors.js';
import { Logger } from '../utils/logger.js';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const DEFAULT_RESUMABLE_THRESHOLD = 5 * 1024 * 1024; // 5 MB
const CHUNK_SIZE = 512 * 1024; // 512 KB (multiple of 256 KB required by Drive API)

export interface IDriveService {
  uploadFile(
    filePathOrBuffer: string | Buffer,
    fileName: string,
    options?: UploadFileOptions,
  ): Promise<UploadedDriveFile>;
  uploadBatch(
    files: { filePath: string; relativePath: string }[],
    options?: BatchUploadOptions,
  ): Promise<UploadedDriveFile[]>;
  findOrCreateFolder(folderName: string, parentFolderId?: string): Promise<DriveFolder>;
  getOrCreateClassroomFolder(courseName: string, assignmentName?: string): Promise<DriveFolder>;
  lookupMimeType(fileNameOrPath: string): string;
}

function formatNetworkError(err: unknown): string {
  const baseMsg =
    err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown network error';
  const cause = (err as { cause?: unknown })?.cause;
  if (!cause) {
    return baseMsg;
  }
  if (cause instanceof Error) {
    return `${baseMsg} (${cause.name}: ${cause.message})`;
  }
  if (typeof cause === 'string') {
    return `${baseMsg} (${cause})`;
  }
  try {
    return `${baseMsg} (${JSON.stringify(cause)})`;
  } catch {
    return baseMsg;
  }
}

/**
 * DriveService
 *
 * Implements Google Drive API v3 operations for uploading assignment files:
 * 1. Multipart upload for files < 5 MB (metadata + binary in single HTTP call).
 * 2. Resumable chunked upload for files >= 5 MB with byte-range tracking.
 * 3. Folder discovery & hierarchical folder creation in Drive (Classroom Submit / Course / Assignment).
 * 4. Comprehensive MIME type detection for programming languages & project files.
 * 5. Batch file upload with progress tracking and typed error handling.
 */
export class DriveService implements IDriveService {
  private readonly getAccessToken: () => Promise<string>;
  private readonly resumableThresholdBytes: number;
  private readonly logger = Logger.getInstance();

  constructor(
    tokenProvider: () => Promise<string>,
    resumableThresholdBytes: number = DEFAULT_RESUMABLE_THRESHOLD,
  ) {
    this.getAccessToken = tokenProvider;
    this.resumableThresholdBytes = resumableThresholdBytes;
  }

  /**
   * Uploads a single file (from file path or in-memory Buffer) to Google Drive.
   * Automatically selects multipart or resumable upload based on file size.
   */
  public async uploadFile(
    filePathOrBuffer: string | Buffer,
    fileName: string,
    options?: UploadFileOptions,
  ): Promise<UploadedDriveFile> {
    if (!fileName || !fileName.trim()) {
      throw new DriveApiError('File name cannot be empty.', 'INVALID_ARGUMENT');
    }

    let fileBuffer: Buffer;
    if (typeof filePathOrBuffer === 'string') {
      try {
        if (!fs.existsSync(filePathOrBuffer)) {
          throw new DriveApiError(
            `File does not exist at path: ${filePathOrBuffer}`,
            'FILE_NOT_FOUND',
          );
        }
        fileBuffer = await fs.promises.readFile(filePathOrBuffer);
      } catch (err) {
        if (err instanceof DriveApiError) {
          throw err;
        }
        this.logger.error(`DriveService: Failed to read file ${filePathOrBuffer}`, err);
        throw new DriveApiError(
          `Unable to read file ${fileName}: ${err instanceof Error ? err.message : String(err)}`,
          'FILE_READ_ERROR',
        );
      }
    } else {
      fileBuffer = filePathOrBuffer;
    }

    const mimeType = options?.mimeType || this.lookupMimeType(fileName);
    const targetName = options?.name || fileName;

    this.logger.info(
      `DriveService: Uploading "${targetName}" (${fileBuffer.length} bytes, MIME: ${mimeType})…`,
    );

    if (fileBuffer.length >= this.resumableThresholdBytes) {
      return this.uploadResumable(fileBuffer, targetName, mimeType, options);
    } else {
      try {
        return await this.uploadMultipart(fileBuffer, targetName, mimeType, options);
      } catch (err) {
        if (err instanceof DriveApiError && err.code === 'NETWORK_ERROR') {
          this.logger.warn(
            `DriveService: Multipart upload failed for "${targetName}" (${err.message}). Retrying with resumable upload protocol…`,
          );
          return await this.uploadResumable(fileBuffer, targetName, mimeType, options);
        }
        throw err;
      }
    }
  }

  /**
   * Uploads a batch of workspace files to Google Drive, reporting progress per file.
   */
  public async uploadBatch(
    files: { filePath: string; relativePath: string }[],
    options?: BatchUploadOptions,
  ): Promise<UploadedDriveFile[]> {
    if (!files || files.length === 0) {
      return [];
    }

    this.logger.info(`DriveService: Starting batch upload of ${files.length} files…`);
    const uploadedFiles: UploadedDriveFile[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) {
        continue;
      }

      if (options?.onProgress) {
        options.onProgress(i, files.length, file.relativePath);
      }

      const uploaded = await this.uploadFile(file.filePath, path.basename(file.relativePath), {
        parentFolderId: options?.parentFolderId,
      });

      uploadedFiles.push(uploaded);

      if (options?.onProgress) {
        options.onProgress(i + 1, files.length, file.relativePath);
      }
    }

    this.logger.info(`DriveService: Successfully uploaded batch of ${uploadedFiles.length} files.`);
    return uploadedFiles;
  }

  /**
   * Finds an existing folder or creates a new one with the given name.
   */
  public async findOrCreateFolder(
    folderName: string,
    parentFolderId?: string,
  ): Promise<DriveFolder> {
    if (!folderName || !folderName.trim()) {
      throw new DriveApiError('Folder name cannot be empty.', 'INVALID_ARGUMENT');
    }

    this.logger.info(`DriveService: Finding or creating folder "${folderName}"…`);

    const sanitizedName = folderName.replace(/'/g, "\\'");
    let q = `mimeType = '${FOLDER_MIME_TYPE}' and name = '${sanitizedName}' and trashed = false`;
    if (parentFolderId) {
      q += ` and '${parentFolderId}' in parents`;
    }

    const searchUrl = new URL(`${DRIVE_API_BASE}/files`);
    searchUrl.searchParams.set('q', q);
    searchUrl.searchParams.set('fields', 'files(id,name,webViewLink)');
    searchUrl.searchParams.set('pageSize', '1');

    const searchRes = await this.executeRequest<DriveFileListResponse>(searchUrl.toString());

    if (searchRes.files && searchRes.files.length > 0 && searchRes.files[0]) {
      const existing = searchRes.files[0];
      this.logger.info(`DriveService: Found existing folder "${folderName}" (ID: ${existing.id})`);
      return {
        id: existing.id,
        name: existing.name,
        webViewLink: existing.webViewLink,
      };
    }

    // Create folder
    const createUrl = `${DRIVE_API_BASE}/files?fields=id,name,webViewLink`;
    const payload: { name: string; mimeType: string; parents?: string[] | undefined } = {
      name: folderName,
      mimeType: FOLDER_MIME_TYPE,
      parents: parentFolderId ? [parentFolderId] : undefined,
    };

    const created = await this.executeRequest<DriveApiFileResource>(createUrl, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    this.logger.info(`DriveService: Created new folder "${folderName}" (ID: ${created.id})`);
    return {
      id: created.id,
      name: created.name,
      webViewLink: created.webViewLink,
    };
  }

  /**
   * Resolves or creates a dedicated hierarchy in Google Drive:
   * "Classroom Submit" ➔ Course Name ➔ Assignment Name (optional)
   */
  public async getOrCreateClassroomFolder(
    courseName: string,
    assignmentName?: string,
  ): Promise<DriveFolder> {
    if (!courseName || !courseName.trim()) {
      throw new DriveApiError('Course name is required.', 'INVALID_ARGUMENT');
    }

    // 1. Root container folder
    const rootFolder = await this.findOrCreateFolder('Classroom Submit');

    // 2. Course folder inside root container
    const courseFolder = await this.findOrCreateFolder(courseName.trim(), rootFolder.id);

    // 3. Assignment folder if provided
    if (assignmentName && assignmentName.trim()) {
      return this.findOrCreateFolder(assignmentName.trim(), courseFolder.id);
    }

    return courseFolder;
  }

  /**
   * Multipart upload for files under threshold (single round-trip).
   */
  private async uploadMultipart(
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string,
    options?: UploadFileOptions,
  ): Promise<UploadedDriveFile> {
    const boundary = `-------classroom_submit_${Date.now()}_${Math.random().toString(36).substring(2)}`;
    const metadata = {
      name: fileName,
      ...(options?.parentFolderId ? { parents: [options.parentFolderId] } : {}),
    };

    const headerPart = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      'utf-8',
    );
    // RFC 2046: Closing boundary delimiter MUST end with CRLF: --{boundary}--\r\n
    const footerPart = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
    const body = Buffer.concat([headerPart, fileBuffer, footerPart]);

    const url = `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,webContentLink,size`;
    const token = await this.getAccessToken();

    let res: Response;
    try {
      const uint8Body = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: uint8Body,
      });
    } catch (err: unknown) {
      const detailMsg = formatNetworkError(err);
      this.logger.error(`DriveService: Multipart upload network failure for ${fileName}`, err);
      throw new DriveApiError(
        `Network error during file upload: ${detailMsg}`,
        'NETWORK_ERROR',
      );
    }

    if (!res.ok) {
      await this.handleHttpError(res, `Upload failed for ${fileName}`);
    }

    if (options?.onProgress) {
      options.onProgress(fileBuffer.length, fileBuffer.length);
    }

    const raw = (await res.json()) as DriveApiFileResource;
    return this.parseDriveFileResource(raw);
  }

  /**
   * Resumable chunked upload for files at or exceeding threshold.
   */
  private async uploadResumable(
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string,
    options?: UploadFileOptions,
  ): Promise<UploadedDriveFile> {
    const metadata = {
      name: fileName,
      ...(options?.parentFolderId ? { parents: [options.parentFolderId] } : {}),
    };

    const initUrl = `${DRIVE_UPLOAD_BASE}/files?uploadType=resumable&fields=id,name,mimeType,webViewLink,webContentLink,size`;
    const token = await this.getAccessToken();

    // 1. Initiate Resumable Upload Session
    let initRes: Response;
    try {
      initRes = await fetch(initUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': String(fileBuffer.length),
        },
        body: JSON.stringify(metadata),
      });
    } catch (err: unknown) {
      const detailMsg = formatNetworkError(err);
      this.logger.error(`DriveService: Resumable session init network error for ${fileName}`, err);
      throw new DriveApiError(
        `Network error initiating resumable upload: ${detailMsg}`,
        'NETWORK_ERROR',
      );
    }

    if (!initRes.ok) {
      await this.handleHttpError(initRes, `Initiating upload session failed for ${fileName}`);
    }

    const uploadUri = initRes.headers.get('location') || initRes.headers.get('Location');
    if (!uploadUri) {
      throw new DriveApiError(
        'Google Drive did not return a resumable session URI.',
        'RESUMABLE_SESSION_FAILED',
      );
    }

    // 2. Upload Data in Chunks
    const totalBytes = fileBuffer.length;
    let offset = 0;
    let finalResource: DriveApiFileResource | undefined;

    if (totalBytes === 0) {
      const emptyRes = await fetch(uploadUri, {
        method: 'PUT',
        headers: {
          'Content-Length': '0',
          'Content-Range': 'bytes */0',
        },
      });
      if (!emptyRes.ok) {
        await this.handleHttpError(emptyRes, `Empty file upload failed for ${fileName}`);
      }
      finalResource = (await emptyRes.json()) as DriveApiFileResource;
    } else {
      while (offset < totalBytes) {
        const end = Math.min(offset + CHUNK_SIZE, totalBytes);
        const chunk = fileBuffer.subarray(offset, end);
        const uint8Chunk = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);

        let chunkRes: Response;
        try {
          chunkRes = await fetch(uploadUri, {
            method: 'PUT',
            headers: {
              'Content-Length': String(chunk.length),
              'Content-Range': `bytes ${offset}-${end - 1}/${totalBytes}`,
            },
            body: uint8Chunk,
          });
        } catch (err: unknown) {
          const detailMsg = formatNetworkError(err);
          throw new DriveApiError(
            `Network error uploading chunk for ${fileName}: ${detailMsg}`,
            'NETWORK_ERROR',
          );
        }

        // HTTP 308 Resume Incomplete is expected for non-final chunks
        if (chunkRes.status === 308) {
          offset = end;
          if (options?.onProgress) {
            options.onProgress(offset, totalBytes);
          }
          continue;
        }

        if (!chunkRes.ok) {
          await this.handleHttpError(
            chunkRes,
            `Resumable chunk upload failed on bytes ${offset}-${end - 1} for ${fileName}`,
          );
        }

        offset = end;
        if (options?.onProgress) {
          options.onProgress(offset, totalBytes);
        }

        finalResource = (await chunkRes.json()) as DriveApiFileResource;
      }
    }

    if (!finalResource) {
      throw new DriveApiError(
        `Upload for ${fileName} finished without a response resource from Google Drive.`,
        'UPLOAD_FAILED',
      );
    }

    return this.parseDriveFileResource(finalResource);
  }

  /**
   * Executes a standard authenticated JSON request with Google Drive API v3.
   */
  private async executeRequest<T>(url: string, init?: RequestInit): Promise<T> {
    const token = await this.getAccessToken();

    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...init?.headers,
        },
      });
    } catch (err: unknown) {
      const detailMsg = formatNetworkError(err);
      this.logger.error(`DriveService: Network failure reaching ${url}`, err);
      throw new DriveApiError(
        `Network error communicating with Google Drive: ${detailMsg}`,
        'NETWORK_ERROR',
      );
    }

    if (!res.ok) {
      await this.handleHttpError(res, `Drive API request failed for ${url}`);
    }

    return (await res.json()) as T;
  }

  /**
   * Handles HTTP error responses from Google Drive API with friendly diagnostics.
   */
  private async handleHttpError(res: Response, contextMsg: string): Promise<never> {
    const friendlyMsg = friendlyHttpError(res.status, 'Drive');
    let details = '';

    try {
      const errorJson = (await res.json()) as { error?: { message?: string } };
      if (errorJson?.error?.message) {
        details = errorJson.error.message;
      }
    } catch {
      // response might not be JSON
    }

    this.logger.error(`DriveService: HTTP ${res.status} error: ${details || res.statusText}`);

    const message = details ? `${friendlyMsg} (${details})` : friendlyMsg;
    throw new DriveApiError(
      `${contextMsg}: ${message}`,
      res.status === 404 ? 'FILE_NOT_FOUND' : 'DRIVE_API_ERROR',
      res.status,
    );
  }

  /**
   * Maps raw Drive API response to UploadedDriveFile interface.
   */
  private parseDriveFileResource(raw: DriveApiFileResource): UploadedDriveFile {
    return {
      id: raw.id,
      name: raw.name,
      mimeType: raw.mimeType,
      webViewLink: raw.webViewLink,
      webContentLink: raw.webContentLink,
      size: raw.size ? parseInt(raw.size, 10) : undefined,
    };
  }

  /**
   * Determines appropriate MIME type for workspace source files and documents.
   */
  public lookupMimeType(fileNameOrPath: string): string {
    const ext = path.extname(fileNameOrPath).toLowerCase();

    const mimeMap: Record<string, string> = {
      // TypeScript / JavaScript
      '.ts': 'application/typescript',
      '.tsx': 'application/typescript',
      '.js': 'text/javascript',
      '.jsx': 'text/javascript',
      '.mjs': 'text/javascript',
      '.cjs': 'text/javascript',
      '.json': 'application/json',

      // Web
      '.html': 'text/html',
      '.htm': 'text/html',
      '.css': 'text/css',
      '.scss': 'text/x-scss',
      '.less': 'text/x-less',
      '.svg': 'image/svg+xml',

      // Systems & OOP
      '.py': 'text/x-python',
      '.java': 'text/x-java-source',
      '.c': 'text/x-c',
      '.cpp': 'text/x-c',
      '.cc': 'text/x-c',
      '.cxx': 'text/x-c',
      '.h': 'text/x-c',
      '.hpp': 'text/x-c',
      '.cs': 'text/x-csharp',
      '.go': 'text/x-go',
      '.rs': 'text/rust',
      '.rb': 'text/x-ruby',
      '.php': 'text/x-php',
      '.swift': 'text/x-swift',
      '.kt': 'text/x-kotlin',
      '.dart': 'application/dart',

      // Data & Config
      '.sql': 'text/x-sql',
      '.xml': 'application/xml',
      '.yaml': 'text/yaml',
      '.yml': 'text/yaml',
      '.toml': 'text/x-toml',
      '.ini': 'text/plain',
      '.csv': 'text/csv',
      '.sh': 'application/x-sh',
      '.bash': 'application/x-sh',
      '.ps1': 'text/plain',
      '.bat': 'text/plain',
      '.cmd': 'text/plain',

      // Documents & Text
      '.md': 'text/markdown',
      '.txt': 'text/plain',
      '.pdf': 'application/pdf',

      // Archives & Binaries
      '.zip': 'application/zip',
      '.tar': 'application/x-tar',
      '.gz': 'application/gzip',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
    };

    return mimeMap[ext] || 'application/octet-stream';
  }
}
