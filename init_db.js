const { Client } = require('pg');
require('dotenv').config();

async function initDb() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString || connectionString.includes('[YOUR-PASSWORD]')) {
    console.error('❌ Please update the DATABASE_URL in your .env file with your actual password before running this script.');
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false } // Required for Supabase connections from Node
  });

  try {
    await client.connect();
    console.log('✅ Connected to the database.');

    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS quiz_submissions (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255),
        answers JSONB,
        recommendations JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await client.query(createTableQuery);
    console.log('✅ Table "quiz_submissions" created successfully (or already exists).');
    
  } catch (err) {
    console.error('❌ Error initializing database:', err);
  } finally {
    await client.end();
  }
}

initDb();
