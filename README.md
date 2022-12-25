# Electron Web MiniDisc

Electron version of [Web MiniDisc Pro](https://github.com/asivery/webminidisc)

For all the people who want to use all of Web MiniDisc Pro's features but don't want to use Google Chrome
____

## Note for users only

If you're not a developer, and are just looking for a pre-built app, you can download it from the [releases section](https://github.com/asivery/ElectronWMD/releases).

MacOS users might need to run some Terminal commands for the app to work due to Apple's restrictive security policies. These commands are listed from [here](#de-quarantine-the-application) onwards.


## Building
The project consists of two parts:
- The main electron code
- The renderer (GUI) code (The Web MiniDisc project itself)

This repository contains only the main electron app.
Upon building, it will clone the renderer repository ([https://github.com/asivery/webminidisc](https://github.com/asivery/webminidisc)), and build that too.

You can:
- Install node modules (`npm i`) (the `--legacy-peer-deps` switch might be required for newer node.js versions)
- Start the development version (`npm start`)
- Deploy the production version (`npm run dist`)
- Deploy the production versions for macOS (`npm run dist-mac`)
____

### Important development changes

Because of Web Minidisc Pro's reliance on older versions of packages such as React and material-ui, you might need to change

```
npm i
```

to

```
npm i --legacy-peer-deps
```

in `build-renderer.sh` depending on your node.js version.

### Development on macOS
#### Install Xcode Build Tools CLI & Homebrew

Make sure Xcode Build Tools CLI & Homebrew are properly installed - in the Terminal run:
- `xcode-select install` - to install XCode Command Line Tools
- `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"` - to install Homebrew

#### Install gcc & libvips

In macOS Terminal: `brew install --build-from-source gcc`, wait for it to finish then run `brew install vips` (this command may install gcc again from an available pre-built binary, if one exists for your current macOS version, this is normal behaviour as gcc is needed for vips to work).

#### Build
Assuming you've completed the above steps, you should be able to follow the standard procedure - run:

- `npm i --legacy-peer-deps` to install the dependencies
- `npm run dist-mac` to create the binary packages

#### De-quarantine the application
(For users unfamiliar, the following commands may also need Xcode CLI installed, so start with [this](#install-xcode-build-tools-cli--homebrew), then return to this step.)

To de-quarantine the app on macOS run the following command in the terminal:

- `xattr -d com.apple.quarantine "/path/to/your.app"`

#### Sign the binary

To codesign the local binary with a self-signing certificate run:

- `codesign --sign - --force --deep "/path/to/your.app"`

This should be all that is needed, enjoy the application.
____

## Final thoughts

Should you run into any issue, you can, of course, open a new issue on this github or reach out to any of the current contributors via the [MiniDisc.wiki Discord](https://minidisc.wiki/discord) in the #research or #software-help channels


Many thanks to [cybercase](https://github.com/cybercase) for writing the original Web MiniDisc and letting so many people experience this forgotten format again.
