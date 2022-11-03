# Electron Web MiniDisc

Electron version of [Web MiniDisc Pro](https://github.com/asivery/webminidisc)

For all the people who want to use all of Web MiniDisc Pro's features but don't want to use Google Chrome
____

### Note for users only (macOS)
If you're not a developer, and are just looking for a pre-build app, you can download it from the Releases-section on the right, though you may need to run some Terminal-commands for the app to work, due to Apple's restrictive security policies, these commands are listed from step 5 onwards.

Windows and Linux users can proceed as normal, and may disregard all of this. Downloads for those platforms are already provided, and don't require any additional steps. These can also be found from the Releases-section to the right. Enjoy!
____

### Building
The project consists of two parts:
- The main electron code
- The renderer (GUI) code (The Web MiniDisc project itself)

This repository contains only the main electron app.
Upon building, it will clone the renderer repository ([https://github.com/asivery/webminidisc](https://github.com/asivery/webminidisc)), and build that too.

You can:
- Start the development version (`npm start`)
- Install node modules (`npm i`)
- Deploy the production version (`npm run dist`)
- Deploy the production versions for macOS (`npm run dist-mac`)
____

### Important changes for development on Apple Silicon
As of version 1.3.0 of Web MiniDisc Pro and thus ElectronWMD, development and building on Apple Silicon has changed. (Though this mainly applies to Apple Silicon, it may also affect Intel Macs due to possible changes in recently launched versions of macOS.)

Please take careful note of the following additional steps to get successful installation of node, node_modules and building of ElectronWMD going again on Apple Silicon macs going forward.

Note: The following section is written from the perspective of a clean development directory on you local machine, if however you are, yourself, combining development with Web MiniDisc Pro, you may skip steps 1 to 3 and start from step 4. If the required software such as Xcode CLI, Homebrew, gcc & vips are already present on your system, you can also start from step 4.

(However it should be said, the way ElectronWMD is setup currently, if you haven't changed it yourself, it will clone again from the master branch on the aforementioned web minidisc pro repo. If you'd like to change this behavior for you development branch, you can change it in the file "build-renderer.sh", but this is not recommended for beginners.)

#### Step 1

Make sure Xcode Build Tools CLI & Homebrew are properly installed,
 
 - In macOS Terminal: `xcode-select install`, wait for it to finish 
 
#### Step 2

Now proceed with homebrew:
 - `-c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)`
 
#### Step 3
 
 Installation of gcc and lib vips:
 
 - `brew install gcc` or `brew install --build-from-source gcc`^, wait for it to finish,
 - then run `brew install vips` 
 
 ^build from source should not be necessary, but if for some reason on your config gcc fails to install through brew with the first command, you may use this one instead.

#### Step 4 
Assuming you've completed the above steps, all that's left to do is go ahead and visit the terminal just two more times, and run the following command once each, as first run:

- run the command `npm i --legacy-peer-deps` to ensure required dependencies for ElectronWMD are installed

Then to finish off, the last command you're going to run will also include the "--legacy-peer-deps"-part,
- as you're on macOS, you run `npm run dist-mac --legacy-peer-deps`.

the mac versions of ElectronWMD should now start to build, wait for it to finish and check if it completes successfully. (It should).
Output will be found in the newly created folder 'build'.

### Notes
On any recent mac, Apple Silicon especially, this should now successfully build again and you will see the resultant output of a finished production application in the folder 'build/mac' and 'build/mac-arm64'. That's it, you're set.

The next time you want to compile a new build from your work, or install additional node modules, provided you haven't deleted anything from the 'node_modules' folder, you can run both commands from step 4 without the `--legacy-peer-deps`-part.

And, provided you had previously correctly setup macOS/Xcode codesigning, the applications should launch without any hitch, if not follow step 5 & 6 below to de-quarantine the app and to code-sign it with a local user-signing certificate.

#### Step 5
(For users unfamiliar, the following commands may also need Xcode CLI installed, so start with step 1, then return to this step.)

De-quarantining on macOS, in terminal, 

- `xattr -d com.apple.quarantine "/path/to/your.app"`

#### Step 6

Codesign local binary with self-signing certificate:

- `codesign --sign - --force --deep "/path/to/your.app"`

This shouldd be all that is needed, enjoy the application.
____

### Final thoughts

Should you run into any issue, you can of course open a new issue on this github.
Or reach out to any of the current contributors via the usual means.


Many thanks to [cybercase](https://github.com/cybercase) for writing the original Web MiniDisc and letting so many people experience this forgotten format again.
