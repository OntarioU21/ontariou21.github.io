' Starts the U21 rankings server (port 4700) with no window.
' To run it at every login: press Win+R, type shell:startup, and put a shortcut to this file there.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\Mitch\omha-u21-rankings"
sh.Run """C:\Program Files\nodejs\node.exe"" server.js", 0, False
