import { app, BrowserWindow, globalShortcut, Menu, Notification, nativeTheme } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { createTray } from './tray.js';
import Store from 'electron-store';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Resolved preload.js path:', path.join(__dirname, 'preload.js'));

const store = new Store();

let mainWindow;
let isPlaying = false; // Initialize with the default state
let syncStateInterval = null;
let iconColor = 'light',
    playIconPath = path.join(__dirname, `assets/Play_light.png`),
    pauseIconPath = path.join(__dirname, `assets/Pause_light.png`),
    previousIconPath = path.join(__dirname, `assets/Previous_light.png`),
    nextIconPath = path.join(__dirname, `assets/Next_light.png`);
function setThemedIcons() {
    iconColor = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
    console.log(`Theme updated: ${iconColor}`);
    playIconPath = path.join(__dirname, `assets/Play_${iconColor}.png`);
    pauseIconPath = path.join(__dirname, `assets/Pause_${iconColor}.png`);
    previousIconPath = path.join(__dirname, `assets/Previous_${iconColor}.png`);
    nextIconPath = path.join(__dirname, `assets/Next_${iconColor}.png`);
}
setThemedIcons();

Menu.setApplicationMenu(null);

app.on('ready', () => {
    mainWindow = new BrowserWindow({
        width: store.get('windowBounds.width', 800),
        height: store.get('windowBounds.height', 600),
        icon: path.join(__dirname, 'assets', 'favicon_144.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.cjs'),
        },
    });
    mainWindow.loadURL('https://music.youtube.com');
    mainWindow.on('close', (event) => {
        if (syncStateInterval) {
            clearInterval(syncStateInterval); // Clear any intervals or resources
        }
        mainWindow = null; // Clear the reference to the window
    });
    mainWindow.on('show', () => {
        mainWindow.setBounds(store.get('windowBounds', { width: 800, height: 600 }));
        mainWindow.setSkipTaskbar(false);

        updateThumbarButtons();
    });
    mainWindow.on('minimize', (event) => {
        event.preventDefault();
        if (mainWindow) {
            mainWindow.hide(); // Hide the window from view
            mainWindow.setSkipTaskbar(true); // Hide it from the taskbar

            // Ensure Media Session remains active
            mainWindow.setBounds({
                width: 1,
                height: 1,
                x: -1000, // Move it offscreen
                y: -1000,
            });
        }
    });
    createTray(mainWindow, app);

    //mainWindow.webContents.openDevTools();

    // Initialize thumbar buttons
    updateThumbarButtons();

    globalShortcut.register('CmdOrCtrl+M', () => {
        toggleMiniPlayer(mainWindow);
    });
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

const toggleMiniPlayer = (mainWindow) => {
    const bounds = mainWindow.getBounds();
    if (bounds.width > 400) {
        mainWindow.setBounds({ width: 300, height: 300 });
    } else {
        mainWindow.setBounds({ width: 800, height: 600 });
    }
};
let previousTrackDetails = { title: '', artist: '', album: '' }; // Store the last known track details

const updateThumbarButtons = () => {
    const playPauseIcon = isPlaying
        ? pauseIconPath
        : playIconPath;

    mainWindow.webContents.executeJavaScript('window.controls.getCurrentTrackDetails()')
        .then((trackDetails) => {
            const title = `${trackDetails.title} - ${trackDetails.artist}`;
            mainWindow.setTitle(title); // Update taskbar tooltip

            // Show a notification if the track has changed
            if (
                trackDetails.title !== previousTrackDetails.title ||
                trackDetails.artist !== previousTrackDetails.artist
            ) {
                //showTrackNotification(trackDetails);
                previousTrackDetails = trackDetails; // Update stored track details
            }

            // Update the thumbar buttons
            mainWindow.setThumbarButtons([
                {
                    tooltip: 'Previous Track',
                    icon: previousIconPath,
                    click: () => {
                        mainWindow.webContents.executeJavaScript('window.controls.pressPrevious()')
                            .catch((error) => console.error('Error executing script:', error));
                    },
                },
                {
                    tooltip: isPlaying ? 'Pause' : 'Play',
                    icon: playPauseIcon,
                    click: () => {
                        isPlaying = !isPlaying;
                        mainWindow.webContents.executeJavaScript('window.controls.pressPlay()')
                            .catch((error) => console.error('Error executing script:', error));
                        updateThumbarButtons(); // Reapply buttons
                    },
                },
                {
                    tooltip: 'Next Track',
                    icon: nextIconPath,
                    click: () => {
                        mainWindow.webContents.executeJavaScript('window.controls.pressNext()')
                            .catch((error) => console.error('Error executing script:', error));
                    },
                },
            ]);
        })
        .catch((error) => {
            console.error('Error fetching track details:', error);
        });
};
const showTrackNotification = (trackDetails) => {
    const notification = new Notification({
        title: 'Now Playing',
        body: `${trackDetails.title} - ${trackDetails.artist}`,
        silent: false, // Optional: Set to true if you don't want a sound
        icon: trackDetails.artwork[0].src, // Optional: Replace with actual album art if available
    });

    notification.show();

    notification.on('click', () => {
        mainWindow.show(); // Bring the app to the foreground when clicked
    });
};

syncStateInterval = setInterval(() => {
    mainWindow.webContents.executeJavaScript('window.controls.isPlaying()').then((playing) => {
        if (isPlaying !== playing) {
            isPlaying = playing;
            updateThumbarButtons(); // Sync the buttons with the current state
        }
    }).catch((error) => console.error('Error checking playback state:', error));
}, 1000); // Check every second

nativeTheme.on('updated', () => {
    setThemedIcons();
    updateThumbarButtons();
});
