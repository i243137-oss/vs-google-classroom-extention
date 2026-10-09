# 🌐 Google Cloud Setup Guide — Classroom Submit Extension

This guide walks you through setting up a Google Cloud project and obtaining OAuth 2.0 credentials required by the **Classroom Submit** VS Code extension.

> ⚠️ **CRITICAL SECURITY RULE:**  
> Never commit your OAuth Client ID or Client Secret to Git, and never share them publicly. The extension stores all tokens securely using VS Code's encrypted `SecretStorage`.

---

## Step 1: Create a Google Cloud Project

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Log in with your Google account (either your personal account or university/school account).
3. In the top navigation bar, click the **Project Selector** dropdown (next to the Google Cloud logo).
4. Click **New Project** in the upper-right corner of the dialog.
5. Fill in the project details:
   - **Project Name:** `Classroom Submit Extension` (or any name you prefer)
   - **Organization:** Select your organization or leave as `No organization`
6. Click **Create** and wait a few seconds for project provisioning to finish.
7. Switch to your newly created project using the Project Selector dropdown.

---

## Step 2: Enable Required APIs

The extension communicates with two official Google APIs: **Google Classroom API** and **Google Drive API**.

1. In the Google Cloud Console, open the navigation menu (☰) and select **APIs & Services > Library**.
2. Search for and enable the following APIs:
   - **Google Classroom API**: Click **Enable**.
   - **Google Drive API**: Click **Enable**.
3. Confirm that both APIs appear under **APIs & Services > Enabled APIs & services**.

---

## Step 3: Configure the OAuth Consent Screen

Before generating credentials, you must configure the user consent screen:

1. In the left navigation menu under **APIs & Services**, select **OAuth consent screen**.
2. Select the user type:
   - **External**: Required if using a personal `@gmail.com` account or submitting from outside a Google Workspace tenant.
   - **Internal**: If your school/organization provides a Google Workspace account and all users belong to the same domain.
3. Click **Create**.
4. Fill in the required **App Information**:
   - **App name:** `Classroom Submit`
   - **User support email:** Select your email address.
   - **Developer contact information:** Enter your email address.
5. Click **Save and Continue**.

---

## Step 4: Configure Required Scopes

1. On the **Scopes** step, click **Add or Remove Scopes**.
2. Select or manually enter the following scopes:
   - `.../auth/userinfo.email` — View your email address.
   - `.../auth/userinfo.profile` — View your basic profile info.
   - `.../auth/classroom.courses.readonly` — View your Google Classroom courses.
   - `.../auth/classroom.coursework.me` — View and submit assignments in Google Classroom.
   - `.../auth/classroom.student-submissions.me.readonly` — View your student submission details.
   - `.../auth/classroom.student-submissions.students.readonly` — View student submission metadata.
   - `.../auth/drive.file` — View and manage Google Drive files created by this extension (least-privilege Drive scope).
3. Click **Update** and then **Save and Continue**.
4. In the **Test Users** section (for External apps in Testing mode):
   - Click **Add Users**.
   - Add the Google email address of the account you will use to test/submit assignments.
5. Click **Save and Continue**, then review and finish.

---

## Step 5: Configure Credentials (OAuth 2.0 Client ID)

1. Navigate to **APIs & Services > Credentials**.
2. Click **+ CREATE CREDENTIALS** at the top and select **OAuth client ID**.
3. Select **Application type**:
   - Select **Web application**.
4. Enter the details:
   - **Name:** `VS Code Classroom Submit Client`
5. Under **Authorized redirect URIs**:
   - Click **+ ADD URI**.
   - Enter the loopback redirect URI:
     ```
     http://localhost:5000/auth/google/callback
     ```
   - *(Optional)* Under **Authorized JavaScript origins**:
     ```
     http://localhost:5000
     ```
6. Click **Create**.
7. An **OAuth client created** dialog will appear displaying:
   - **Client ID** (e.g. `xxxxxxxxxxxx-xxxxxxxxxxxxxxxx.apps.googleusercontent.com`)
   - **Client Secret** (e.g. `GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxx`)
8. Copy these values to a secure temporary clipboard (do NOT paste them into any public file).

---

## Step 6: Configure Credentials in VS Code

You can configure your credentials using either of the two methods below:

### Method A: Using the Command Palette (Recommended)
1. In VS Code, open the Command Palette (`Ctrl+Shift+P` on Windows/Linux, `Cmd+Shift+P` on macOS).
2. Type and run:
   ```
   Classroom: Configure Credentials
   ```
3. Paste your **Client ID** when prompted and press `Enter`.
4. Paste your **Client Secret** when prompted (masked input) and press `Enter`.
5. The extension will securely save your settings.

### Method B: Via VS Code Settings
1. Open VS Code Settings (`Ctrl+,` or `File > Preferences > Settings`).
2. Search for `Classroom Submit`.
3. Set:
   - **Classroom Submit: Client Id**: Paste your Client ID.
   - **Classroom Submit: Client Secret**: Paste your Client Secret.
   - **Classroom Submit: Redirect Uri**: Verify it matches `http://localhost:5000/auth/google/callback`.

---

## Step 7: Run the Extension and Sign In

1. Open the Command Palette (`Ctrl+Shift+P`).
2. Run:
   ```
   Classroom: Sign In
   ```
3. Your default web browser will automatically open Google's OAuth consent page.
4. Select your authorized Google account and grant the requested permissions.
5. The browser will redirect to `http://localhost:5000/auth/google/callback` and display:
   ```
   ✓ Sign-in Successful
   You have signed in to Google Classroom. You can close this browser tab and return to VS Code.
   ```
6. Inside VS Code, you will see a confirmation notification:
   ```
   ✓ Classroom Submit: Signed in successfully as your-email@gmail.com.
   ```

To sign out at any time, run:
```
Classroom: Sign Out
```
This safely revokes your Google tokens and deletes them from VS Code's encrypted SecretStorage.
