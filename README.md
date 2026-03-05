# RAFO Calibration Center Time Display

A web-based tiled clock inspired by PTB's time display, customized for **Royal Air Force of Oman (RAFO) Calibration Center**.

## Features

- Tiled layout for Hours, Minutes, Seconds, and **Milliseconds**.
- Fixed display in **Oman time (GST / UTC+4)**.
- Attempts to synchronize against `time.gov` (`/actualtime.cgi`) and continuously renders a smooth local high-resolution clock between syncs.
- Dedicated placeholder to insert the RAFO Calibration Center logo.
- Static-site friendly: deploy directly to Netlify.

## Local preview

Because browsers restrict some cross-origin behaviors from local `file://` paths, run a simple local web server:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`.

## Netlify deployment

1. Push this folder to a Git repository.
2. In Netlify, choose **Add new site → Import an existing project**.
3. Select your repo.
4. Build command: *(leave empty)*
5. Publish directory: `.`
6. Deploy.

## Logo integration

Replace the `.logo-slot` div in `index.html` with your image, for example:

```html
<img src="rafo-logo.png" alt="RAFO Calibration Center logo" class="logo-image" />
```

And add CSS sizing rules in `styles.css` as needed.
