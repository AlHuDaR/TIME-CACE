// gps-proxy.js - Backend Node.js proxy for GPS receiver (using native net)
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const net = require('net');

const app = express();
const PORT = process.env.PORT || 3000;

// Oman timezone offset (GST = UTC+4)
const OMAN_OFFSET_MS = 4 * 60 * 60 * 1000;

// Track last connection time
let lastConnectionAttempt = 0;
const MIN_CONNECTION_INTERVAL = 5000;

// GPS Configuration
const GPS_HOST = '192.168.50.2';
const GPS_PORT = 23;
const GPS_USERNAME = 'operator';
const GPS_PASSWORD = 'janus';

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files
const publicPath = path.resolve(__dirname);
app.use(express.static(publicPath));

// Helper: Format date consistently (uses server locale for fallback only)
function formatDate(date) {
  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric'
  }).format(date);
}

function formatTime(date) {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date);
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Helper: Get precise Internet time (UTC)
async function getPreciseInternetTime() {
  const timeSources = [
    'https://time.google.com',
    'https://www.time.gov',
    'https://www.microsoft.com'
  ];
  
  const measurements = await Promise.allSettled(
    timeSources.map(async (url) => {
      const start = Date.now();
      try {
        const response = await fetch(url, { method: 'HEAD', timeout: 5000 });
        const end = Date.now();
        return {
          url,
          rtt: end - start,
          date: response.headers.get('date')
        };
      } catch (e) {
        return { url, error: e.message };
      }
    })
  );
  
  const successful = measurements
    .filter(r => r.status === 'fulfilled' && r.value.date)
    .map(r => r.value);
  
  if (successful.length === 0) {
    throw new Error('No time servers reachable');
  }
  
  const best = successful.reduce((prev, curr) => 
    prev.rtt < curr.rtt ? prev : curr
  );
  
  const serverTime = new Date(best.date);
  const networkDelay = Math.round(best.rtt / 2);
  const adjustedTime = new Date(serverTime.getTime() + networkDelay);
  
  return {
    timestamp: adjustedTime.getTime(),
    sourcesReached: successful.length
  };
}

// Helper: Connect to GPS
function connectToGPS(command, expectOk = false) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = '';
    let state = 'connecting';
    
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Connection timeout'));
    }, 15000);
    
    socket.connect(GPS_PORT, GPS_HOST, () => {
      console.log('TCP socket connected');
    });
    
    socket.on('data', (data) => {
      buffer += data.toString();
      
      if (state === 'connecting' && buffer.includes('USER NAME:')) {
        state = 'username';
        buffer = '';
        socket.write(GPS_USERNAME + '\r\n');
      }
      else if (state === 'username' && buffer.includes('PASSWORD:')) {
        state = 'password';
        buffer = '';
        socket.write(GPS_PASSWORD + '\r\n');
      }
      else if (state === 'password' && buffer.includes('LOGIN SUCCESSFUL!')) {
        state = 'loggedin';
        buffer = '';
        setTimeout(() => {
          state = 'command';
          socket.write(command);
        }, 500);
      }
      else if (state === 'command') {
        if (expectOk && buffer.includes('OK')) {
          state = 'done';
          clearTimeout(timeout);
          socket.destroy();
          resolve(buffer);
        }
        else if (!expectOk && (buffer.includes('F3') || buffer.match(/\d{2}\/\d{2}\/\d{4}/))) {
          state = 'done';
          clearTimeout(timeout);
          socket.destroy();
          resolve(buffer);
        }
      }
    });
    
    socket.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    
    socket.on('close', () => {
      if (state !== 'done') {
        clearTimeout(timeout);
        if (buffer.includes('OK') || buffer.includes('F3')) {
          resolve(buffer);
        } else {
          reject(new Error('Socket closed unexpectedly'));
        }
      }
    });
  });
}

// GET /api/time - Read GPS (receiver returns Oman time)
app.get('/api/time', async (req, res) => {
  const now = Date.now();
  const timeSinceLastAttempt = now - lastConnectionAttempt;
  
  if (timeSinceLastAttempt < MIN_CONNECTION_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_CONNECTION_INTERVAL - timeSinceLastAttempt));
  }
  
  lastConnectionAttempt = Date.now();
  
  try {
    const response = await connectToGPS('F3\r\n');
    
    // Parse: "F3 UTC 03/08/2026 00:46:00" (this is Oman time from receiver)
    const match = response.match(/F3\s+\w+\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/);
    let dateStr, timeStr;
    
    if (!match) {
      // Fallback for older format
      const simpleMatch = response.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/);
      if (!simpleMatch) throw new Error('Could not parse time');
      [_, dateStr, timeStr] = simpleMatch;
    } else {
      [_, dateStr, timeStr] = match;
    }
    
    // Parse Oman time components
    const [month, day, year] = dateStr.split('/').map(Number);
    const [hours, minutes, seconds] = timeStr.split(':').map(Number);
    
    // Create UTC timestamp from Oman time: Oman is UTC+4, so UTC = Oman - 4 hours
    // We use Date.UTC to treat the parsed numbers as UTC, then subtract the offset
    const utcTimestamp = Date.UTC(year, month - 1, day, hours, minutes, seconds) - OMAN_OFFSET_MS;
    
    res.json({
      success: true,
      source: 'gps-receiver',
      date: dateStr,
      time: timeStr,
      timezone: 'GST (UTC+04:00)',
      timestamp: utcTimestamp,  // Now sends UTC timestamp for correct offset calculation
      raw: response.trim()
    });
    
  } catch (error) {
    console.error('GPS Connection Error:', error.message);
    const fallbackDate = new Date();
    res.status(503).json({
      success: false,
      source: 'gps-receiver',
      date: formatDate(fallbackDate),
      time: formatTime(fallbackDate),
      timestamp: fallbackDate.getTime(),
      error: error.message,
      available: false
    });
  }
});

// POST /api/time/set - Set GPS time
app.post('/api/time/set', async (req, res) => {
  try {
    let omanTimeMs, source;
    
    if (req.body.useInternet) {
      // Internet time is UTC, add 4 hours to get Oman time
      const internetTime = await getPreciseInternetTime();
      omanTimeMs = internetTime.timestamp + OMAN_OFFSET_MS;
      source = 'internet';
    } else {
      // PC time - assume PC is set to Oman time
      omanTimeMs = Date.now();
      source = 'computer';
    }
    
    // Create date object from Oman timestamp
    const omanDate = new Date(omanTimeMs);
    
    // Use UTC methods to format Oman time correctly regardless of server timezone
    const mm = String(omanDate.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(omanDate.getUTCDate()).padStart(2, '0');
    const yyyy = omanDate.getUTCFullYear();
    const hh = String(omanDate.getUTCHours()).padStart(2, '0');
    const min = String(omanDate.getUTCMinutes()).padStart(2, '0');
    const ss = String(omanDate.getUTCSeconds()).padStart(2, '0');
    
    // Send Oman time directly (receiver handles it as local time)
    const command = `F3 UTC ${mm}/${dd}/${yyyy} ${hh}:${min}:${ss}\r\n`;
    await connectToGPS(command, true);
    
    res.json({
      success: true,
      message: 'GPS time set successfully',
      date: `${mm}/${dd}/${yyyy}`,
      time: `${hh}:${min}:${ss}`,
      timezone: 'GST (UTC+04:00)',
      source: source
    });
    
  } catch (error) {
    console.error('Set GPS Time Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/time/ntp - Internet time (returns Oman time display, UTC timestamp)
app.get('/api/time/ntp', async (req, res) => {
  try {
    const internetTime = await getPreciseInternetTime();
    
    // Calculate Oman time for display purposes
    const omanTimeMs = internetTime.timestamp + OMAN_OFFSET_MS;
    const omanDate = new Date(omanTimeMs);
    
    // Use UTC methods to format Oman time string correctly regardless of server timezone
    const mm = String(omanDate.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(omanDate.getUTCDate()).padStart(2, '0');
    const yyyy = omanDate.getUTCFullYear();
    const hh = String(omanDate.getUTCHours()).padStart(2, '0');
    const min = String(omanDate.getUTCMinutes()).padStart(2, '0');
    const ss = String(omanDate.getUTCSeconds()).padStart(2, '0');
    
    res.json({
      success: true,
      source: 'internet-ntp',
      date: `${mm}/${dd}/${yyyy}`,
      time: `${hh}:${min}:${ss}`,
      timezone: 'GST (UTC+04:00)',
      timestamp: internetTime.timestamp  // Send UTC timestamp, not Oman time!
    });
  } catch (error) {
    const fallbackDate = new Date();
    res.status(503).json({
      success: false,
      source: 'internet-ntp',
      date: formatDate(fallbackDate),
      time: formatTime(fallbackDate),
      timestamp: fallbackDate.getTime(),
      error: error.message,
      available: false
    });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  const localUrl = `http://localhost:${PORT}`;
  
  console.log(`GPS Server running on port ${PORT}`);
  console.log(`\x1b[36m%s\x1b[0m`, `Local Server: ${localUrl}`);  // Cyan color for visibility
  console.log(`GPS Receiver: ${GPS_HOST}:${GPS_PORT}`);
  console.log(`Mode: F69 UTC (receiver shows Oman time)`);
  console.log(`Timezone: Server timezone independent (uses UTC math)`);
  console.log(`Press Ctrl+Click the link above to open browser`);
  
  // Optional: Auto-open browser on Windows (require child_process before enabling)
  /*
  exec(`start ${localUrl}`, (err) => {
    if (err) console.log('Could not auto-open browser');
  });
  */
});
