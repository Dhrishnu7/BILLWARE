@echo off
echo ==============================================
echo Deploying to default project (mmpakkam)...
echo ==============================================
call ..\firebase.exe deploy --only hosting

echo.
echo ==============================================
echo Deploying to mybillware project...
echo ==============================================
call ..\firebase.exe deploy --only hosting --project mybillware

echo.
echo Both deployments completed!
