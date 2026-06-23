# Deployment Instructions
Whenever you deploy the application to Firebase, you MUST deploy to both the `mmpakkam` and `mybillware` projects simultaneously.

To do this, ALWAYS run the `deploy_both.cmd` script located in the `MM Pakkam` directory instead of running `firebase deploy` manually.

Example:
```powershell
.\deploy_both.cmd
```
