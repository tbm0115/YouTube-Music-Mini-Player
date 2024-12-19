# YouTube Music Mini Player

A lightweight and customizable desktop application for YouTube Music, built using [Electron](https://www.electronjs.org/). The application provides a seamless experience for controlling YouTube Music with system tray integration, media controls, and taskbar features.

---

## Features

### **System Tray Integration**
- **Minimize to Tray**: The app minimizes to the system tray.
- **Tray Menu**:
  - Show/Hide the app.
  - Playback controls: Play/Pause, Next, and Previous track.
  - Quit the application.

### **Media Controls**
- **Taskbar Thumbnail Toolbar**:
  - Play/Pause, Next, and Previous buttons directly accessible from the taskbar.
  - Syncs with the current playback state and updates dynamically.
- **Windows Media Overlay**:
  - Supports the native Windows Media Overlay with title, artist, and album information.

### **Now Playing Notifications**
- Displays notifications when the track changes, including:
  - Song title.
  - Artist name.
  - Album artwork.

### **Dark/Light Theme Adaptive Icons**
- Automatically updates button icons and tray icons to match the system's current light or dark theme.

### **Playback State Sync**
- Dynamically updates the app's controls and tooltips to reflect the current playback state (e.g., "Playing" or "Paused").

---

## Installation

### Prerequisites
1. Install [Node.js](https://nodejs.org/) (version 14 or later).
2. Install [Git](https://git-scm.com/).

### Steps
1. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/youtube-music-mini-player.git
   cd youtube-music-mini-player
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the app in development mode:
   ```bash
   npm start
   ```

---

## Build

To build the app for distribution:

1. Install `electron-builder` (if not already installed):
   ```bash
   npm install electron-builder --save-dev
   ```
2. Build the app:
   ```bash
   npm run build
   ```
3. Find the distributable files in the `dist` directory.

---

## Usage

- **Run the App**: Double-click the executable after building.
- **Minimize to Tray**: Press the minimize button on the window.
- **Tray Menu**:
  - **Show App**: Reopens the main app window.
  - **Play/Pause, Next, Previous**: Controls playback.
  - **Quit**: Exits the app.

---
### Key Features in Code
- **Media Session API**: Used to integrate with Windows Media Overlay.
- **Electron's Thumbnail Toolbar**: Adds taskbar media controls.
- **Dynamic Theme Detection**: Updates icons based on light/dark mode.

---

## Contributing

Contributions are welcome! Please:
1. Fork the repository.
2. Create a new branch:
   ```bash
   git checkout -b feature-name
   ```
3. Make your changes and commit them:
   ```bash
   git commit -m "Description of changes"
   ```
4. Push to your branch:
   ```bash
   git push origin feature-name
   ```
5. Open a pull request.

---

## Future Improvements
- Add support for custom hotkeys.
- Implement additional playback features (e.g., shuffle, repeat).

---

## Screenshots
![Window Screenshot](https://github.com/user-attachments/assets/aec1db22-7b3a-4d21-be01-572a5d07b7b0)
![Window Thumbar Screenshot](https://github.com/user-attachments/assets/a15fb1f7-06fa-4e0f-9817-b4b6d50614e5)
![System Tray Menu Screenshot](https://github.com/user-attachments/assets/d609439c-77c6-4d60-89a1-cc852e412738)

---

## Acknowledgments

- [Electron](https://www.electronjs.org/) for powering the app.
- [YouTube Music](https://music.youtube.com/) for being the core platform.

