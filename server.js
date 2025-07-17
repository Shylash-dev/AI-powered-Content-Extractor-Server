require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const mongoose = require('mongoose');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB connection
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB connected"))
    .catch((error) => console.error("MongoDB error:", error));

// Mongoose schema
const Summary = mongoose.model('Summary', new mongoose.Schema({
    url: String,
    title: String,
    summary: String,
    keyPoints: [String],
}, { timestamps: true }));

// Gemini AI setup
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Scrape readable text content from a page
async function scrapeContent(url) {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    return $('body').text().replace(/\s+/g, ' ').trim().slice(0, 10000);
}

// Route to summarize a URL
app.post('/api/summarize', async (req, res) => {
    const { url } = req.body;

    try {
        const content = await scrapeContent(url);
        const model = genAI.getGenerativeModel({ model: 'models/gemini-1.5-flash' });

        const prompt = `Summarize the following web page and list 5 key points:\n\n${content}`;

        const result = await model.generateContent(prompt);
        const response = await result.response.text();

        const [summaryLine, ...points] = response.split('\n').filter(line => line.trim());

        const doc = await Summary.create({
            url,
            title: url, // you can extract the <title> tag if you want
            summary: summaryLine,
            keyPoints: points,
        });

        res.json(doc);
    } catch (err) {
        console.error("Error generating summary:", err);
        res.status(500).json({ error: 'Failed to generate summary' });
    }
});

// Route to fetch summaries with filters
app.get('/api/summary', async (req, res) => {
    const { search, domain, fromDate, toDate } = req.query;

    const filter = {};

    if (search) {
        filter.$or = [
            { title: new RegExp(search, 'i') },
            { summary: new RegExp(search, 'i') },
            { keyPoints: new RegExp(search, 'i') },
        ];
    }

    if (domain) {
        filter.url = new RegExp(domain.replace(/\./g, '\\.'), 'i'); // escape dot for regex
    }

    if (fromDate || toDate) {
        filter.createdAt = {};
        if (fromDate) filter.createdAt.$gte = new Date(fromDate);
        if (toDate) filter.createdAt.$lte = new Date(toDate);
    }

    try {
        const data = await Summary.find(filter)
            .sort({ createdAt: -1 }) // newest first
            .limit(100);

        res.json(data);
    } catch (err) {
        console.error("Error fetching summaries:", err);
        res.status(500).json({ error: 'Failed to fetch summaries' });
    }
});

// Start the server
app.listen(5000, () => console.log('Server running on http://localhost:5000'));
