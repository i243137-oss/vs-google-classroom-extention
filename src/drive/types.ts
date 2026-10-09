/**
 * DriveService type definitions for Google Drive API v3 operations.
 */

export interface UploadedDriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string | undefined;
  webContentLink?: string | undefined;
  size?: number | undefined;
}

export interface DriveFolder {
  id: string;
  name: string;
  webViewLink?: string | undefined;
}

export interface UploadFileOptions {
  name?: string | undefined;
  mimeType?: string | undefined;
  parentFolderId?: string | undefined;
  onProgress?: ((bytesUploaded: number, totalBytes: number) => void) | undefined;
}

export interface BatchUploadOptions {
  parentFolderId?: string | undefined;
  onProgress?: ((completedCount: number, totalCount: number, currentFileName: string) => void) | undefined;
}

export interface DriveApiFileResource {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string | undefined;
  webContentLink?: string | undefined;
  size?: string | undefined;
  parents?: string[] | undefined;
}

export interface DriveFileListResponse {
  files?: DriveApiFileResource[] | undefined;
  nextPageToken?: string | undefined;
}
