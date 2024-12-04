require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const axios = require('axios');  // For calling HERE API
const mongoUri = process.env.MONGODB_URI;

const hereApiKey = 'iMr3ZlmiGokEaOlNNtIALL6qoq--OXqktFg0RpANP8A';  // HERE API key

// Connect to MongoDB
mongoose.connect(mongoUri)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('Could not connect to MongoDB:', err));

// Define schema for geofence log
const geofenceLogSchema = new mongoose.Schema({
    deviceId: Number,
    geofenceId: Number,
    entry: {
        latitude: Number,
        longitude: Number,
        timestamp: Date
    },
    exit: {
        latitude: Number,
        longitude: Number,
        timestamp: Date
    },
    distance: Number // Field to store distance
});

// Create a model from the schema
const GeofenceLog = mongoose.model('GeofenceLog', geofenceLogSchema);

const app = express();
app.use(bodyParser.json());

// Temporary storage for latest entry events
const latestEntries = {};

// Helper function to calculate distance using HERE API
async function calculateDistance(entryCoordinates, exitCoordinates) {
    const origin = `${entryCoordinates.latitude},${entryCoordinates.longitude}`;
    const destination = `${exitCoordinates.latitude},${exitCoordinates.longitude}`;
    
    try {
        const response = await axios.get('https://router.hereapi.com/v8/routes', {
            params: {
                apiKey: hereApiKey,
                origin,
                destination,
                return: 'summary'
            }
        });

        const distance = response.data.routes[0].sections[0].summary.length;  // distance in meters
        return distance;
    } catch (error) {
        console.error('Error fetching distance from HERE API:', error);
        return null;  // Return null if error occurs
    }
}

// Endpoint to receive geofence notifications from Traccar
app.post('/geofence', async (req, res) => {
    try {
        const { deviceId, event, geofenceId, latitude, longitude, timestamp } = req.body;

        if (event === 'geofenceEnter') {
            // Store entry event data temporarily for this device
            latestEntries[deviceId] = {
                latitude,
                longitude,
                timestamp: new Date(timestamp)
            };
            console.log(`Entry recorded for device ${deviceId}`);
            res.status(200).json({ message: 'Geofence entry recorded' });

        } else if (event === 'geofenceExit') {
            // Check if an entry exists for this device
            const entryData = latestEntries[deviceId];

            if (!entryData) {
                // If no entry data, exit event cannot be paired, return an error
                return res.status(400).json({ message: 'No entry event found for this device' });
            }

            // Calculate distance between entry and exit locations using HERE API
            const distance = await calculateDistance(entryData, { latitude, longitude });

            if (distance === null) {
                return res.status(500).json({ message: 'Failed to calculate distance' });
            }

            // Only store if distance is greater than 20 km (20,000 meters)
            if (distance > 20000) {
                // Save both entry and exit in a single document with distance
                const geofenceLog = new GeofenceLog({
                    deviceId,
                    geofenceId,
                    entry: entryData,
                    exit: {
                        latitude,
                        longitude,
                        timestamp: new Date(timestamp)
                    },
                    distance: distance  // Store calculated distance
                });

                await geofenceLog.save();

                // Clear the entry data after saving
                delete latestEntries[deviceId];

                console.log(`Entry/Exit log saved for device ${deviceId}`);
                res.status(200).json({ message: 'Geofence entry/exit event logged successfully' });
            } else {
                // If the distance is not greater than 20 km, ignore the event
                console.log(`Distance too short to save: ${distance / 1000} km`);
                res.status(200).json({ message: 'Distance too short to store in database' });
            }

        } else {
            res.status(400).json({ message: 'Invalid event type' });
        }
    } catch (error) {
        console.error('Error handling geofence event:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Start the server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
