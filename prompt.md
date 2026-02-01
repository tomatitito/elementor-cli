I want you to run do the following using commands and subcommands of `elementor-cli`. Every command could fail. If it does, write a note about the failed command into a file called `failed_commands.md`. Then diagnose the issue and write an analysis to a file. Then use this file to fix the issue. After fixing the issue, run the command again. If the fix was successfull, commit and push. Then start from 1. again.

1. Check if there are pages for the staging site locally using `stages list`. If you find any, delete them via the `delete` command.
2. Check if a local staging environment is running using `preview status`. If it is, stop it using `preview stop`.
3. Spin up a new staging environment using `preview start`. Wait until it is ready. You can check using the `preview status` command.
4. List all pages using `pages list`.
5. Download all pages using `pull`.
6. Pick a page and create a clone of it using the `pages create` command.
7. Upload the cloned page using `pages push`.
8. Use agent-browser and browser-tools to check that the original and the cloned page are identical.
9. Create a new page from a template. Try every template available.
10. After creating a page from a template, upload it using `pages push` and look at it. Make sure the page works as expected.
11. Edit a page and use the `preview sync` command to update the staging environment. Check that the page is actually updated using the browser.
12. Shut down the staging environment using `preview stop`.

Complete when:
- You were able to successfully complete all commands listed above.
- You fixed all issues that occurred during the process.
- Output: <promise>COMPLETE</promise>
