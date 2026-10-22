@echo off
REM ==============================================================================
REM Instagram REST API Script for @thesimplekrew
REM Scoped API Key: ig_live_gjykSUnVhUbjZp3FWitaGTQvU3vNOzhI
REM Production URL: https://instagramagentmcp-vercel.vercel.app
REM ==============================================================================

SET API_KEY=ig_live_gjykSUnVhUbjZp3FWitaGTQvU3vNOzhI
SET BASE_URL=https://instagramagentmcp-vercel.vercel.app
SET TARGET_ACCOUNT=thesimplekrew

IF "%~1"=="" GOTO usage
IF /I "%~1"=="info" GOTO get_info
IF /I "%~1"=="media" GOTO get_media
IF /I "%~1"=="post" GOTO post_image
IF /I "%~1"=="generate" GOTO generate_post
GOTO usage

:get_info
echo [1/1] Fetching Account Info for @%TARGET_ACCOUNT%...
curl -s -X GET "%BASE_URL%/api/rest/me?account=%TARGET_ACCOUNT%" ^
  -H "Authorization: Bearer %API_KEY%"
echo.
GOTO :eof

:get_media
echo [1/1] Fetching Recent Media for @%TARGET_ACCOUNT%...
curl -s -X GET "%BASE_URL%/api/rest/media?account=%TARGET_ACCOUNT%&limit=5" ^
  -H "Authorization: Bearer %API_KEY%"
echo.
GOTO :eof

:post_image
IF "%~2"=="" (
  echo ERROR: Missing image URL.
  echo Usage: thesimplekrew_crm.cmd post ^<IMAGE_URL^> ^<CAPTION^>
  GOTO :eof
)
IF "%~3"=="" (
  echo ERROR: Missing caption.
  echo Usage: thesimplekrew_crm.cmd post ^<IMAGE_URL^> ^<CAPTION^>
  GOTO :eof
)
echo [1/1] Publishing Photo to @%TARGET_ACCOUNT%...
curl -s -X POST "%BASE_URL%/api/rest/post" ^
  -H "Authorization: Bearer %API_KEY%" ^
  -H "Content-Type: application/json" ^
  -d "{\"account\":\"%TARGET_ACCOUNT%\",\"image_url\":\"%~2\",\"caption\":\"%~3\"}"
echo.
GOTO :eof

:generate_post
IF "%~2"=="" (
  echo ERROR: Missing prompt.
  echo Usage: thesimplekrew_crm.cmd generate ^<IMAGE_PROMPT^> ^<CAPTION^>
  GOTO :eof
)
echo [1/1] Generating AI Image and Posting to @%TARGET_ACCOUNT%...
curl -s -X POST "%BASE_URL%/api/rest/generate-and-post" ^
  -H "Authorization: Bearer %API_KEY%" ^
  -H "Content-Type: application/json" ^
  -d "{\"account\":\"%TARGET_ACCOUNT%\",\"prompt\":\"%~2\",\"caption\":\"%~3\"}"
echo.
GOTO :eof

:usage
echo ==============================================================================
echo Instagram CRM Runner for @thesimplekrew
echo ==============================================================================
echo.
echo Usage:
echo   thesimplekrew_crm.cmd info
echo       - Verifies account connection and returns details.
echo.
echo   thesimplekrew_crm.cmd media
echo       - Fetches the last 5 posts and metrics.
echo.
echo   thesimplekrew_crm.cmd post ^<IMAGE_URL^> ^<CAPTION^>
echo       - Publishes a photo to @thesimplekrew.
echo.
echo   thesimplekrew_crm.cmd generate ^<IMAGE_PROMPT^> ^<CAPTION^>
echo       - Generates an image with Pollinations AI and posts it.
echo.
echo Example:
echo   thesimplekrew_crm.cmd post "https://example.com/banner.jpg" "Hello from CRM!"
echo ==============================================================================
