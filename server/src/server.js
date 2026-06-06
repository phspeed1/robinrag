const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const passport = require('passport');
const session = require('express-session');
const cron = require('node-cron');
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
require('./passport'); // Import Passport Config

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const prisma = new PrismaClient();

// Trust Proxy (Required for secure cookies behind Nginx)
app.set('trust proxy', 1);

// Middleware
app.use(cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true
}));
app.use(express.json());

// Session is required for Passport OAuth2 state param
app.use(session({
    secret: process.env.SESSION_SECRET || 'keyboard cat',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

app.use(passport.initialize());
app.use(passport.session());

app.get('/', (req, res) => {
    res.send('Server is running');
});

// Routes
const authRoutes = require('./auth');
app.use('/auth', authRoutes);

// Supabase Keep-Alive Cron Job (Runs every day at midnight)
cron.schedule('0 */6 * * *', async () => {
try {
        console.log('Running Supabase REST API Keep-Alive...');
        
        // Supabase 프로젝트 URL에서 REST 주소 추출 (DATABASE_URL을 기반으로 유추하거나 process.env에 주입)
        // 예: https://your-project-id.supabase.co/rest/v1/
        const supabaseUrl = process.env.SUPABASE_URL; 
        const supabaseKey = process.env.SUPABASE_KEY;

        if (supabaseUrl && supabaseKey) {
            await axios.get(`${supabaseUrl}/rest/v1/`, {
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`
                }
            });
            console.log('Supabase REST API Keep-Alive successful');
        } else {
            // 변수가 없다면 기존 Prisma 방식으로 Fallback 처리
            await prisma.$queryRaw`SELECT 1`;
            console.log('Supabase DB Fallback Keep-Alive successful');
        }
    } catch (error) {
        console.error('Supabase Keep-Alive failed:', error.message);
    }});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
