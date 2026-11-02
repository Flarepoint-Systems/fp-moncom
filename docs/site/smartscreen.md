# Windows says "Windows protected your PC"

This is normal for MonCOM. It does not mean anything is wrong.

## Why it happens

MonCOM is not code-signed yet. A signing certificate costs money every year. We skip it for now to keep MonCOM free. Windows SmartScreen warns about any app it does not know.

## How to run MonCOM anyway

1. In the blue dialog, click **More info**.
2. A **Run anyway** button appears. Click it.

You only need to do this once per download.

## Check your download

You can confirm the file is genuine. Each release has a `checksums.txt` file with a SHA256 hash for every download.

1. Open PowerShell in your Downloads folder.
2. Run this command:

```powershell
Get-FileHash .\MonCOM-Setup-<version>.exe -Algorithm SHA256
```

3. Compare the hash with the matching line in `checksums.txt`.

If the two match, your download is intact. If they differ, delete the file and download it again.
