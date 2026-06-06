Set shell = CreateObject("WScript.Shell")
appDir = "C:\Users\tianzhaofeng\Documents\Codex\2026-06-04\new-chat-2\yunchuang-customer-app"
nodePath = "C:\Users\tianzhaofeng\Documents\Codex\tools\node-v26.2.0-win-x64\node.exe"
cmd = "cmd /d /c cd /d """ & appDir & """ && """ & nodePath & """ server.js > server-4184.out.log 2> server-4184.err.log"
shell.Run cmd, 0, False
