# Distribution

MonCOM downloads and the update feed are served by the Flarepoint CDN. GitHub releases stay the build origin.

## Feed URL

Installed builds read `https://cdn.flarepoint.nl/moncom/win/latest.yml`. This URL is set in `build.publish` in `package.json`.

## CDN path contract

The path `/moncom/win/` holds these files:

- `latest.yml`
- `MonCOM-Setup-<v>.exe`
- `MonCOM-Setup-<v>.exe.blockmap`
- `MonCOM-Portable-<v>.exe`
- `checksums.txt`

The `fp-cdn` project implements this contract.

## Caching

Serve `latest.yml` with `Cache-Control: no-cache`. Use an nginx `location = /moncom/win/latest.yml` rule. Without it, clients can miss a new release.

## Publishing order

1. Put the exe and blockmap files in place.
2. Put `latest.yml` last.

The updater reads the yml and then fetches the file it names. If the yml goes first, the download fails.

## Sync job

A sync job on the Pi pulls the assets of the newest published GitHub release. It uses a fine-grained token with Contents: read. Draft releases are not published, so the job ignores them.

## Storage

`fp-cdn` bakes its files into the Docker image today. Installers are large and change often. Put them on a mounted volume, not in the image.

## Downloads page

The page lives at `flarepoint.nl/moncom`. It links the Setup file, the Portable file, `checksums.txt` and the SmartScreen page. The SmartScreen copy is in `docs/site/smartscreen.md`.
