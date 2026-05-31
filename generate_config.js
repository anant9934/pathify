const fs = require('fs');

// Read from environment variables, fallback to defaults if not present
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID || 'service_az4400a';
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID || 'template_ove2j9k';
const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY || '-WSr2Zox6TnvX7osv';

const configContent = `// Auto-generated during Netlify build
const EMAILJS_SERVICE_ID = '${EMAILJS_SERVICE_ID}';
const EMAILJS_TEMPLATE_ID = '${EMAILJS_TEMPLATE_ID}';
const EMAILJS_PUBLIC_KEY = '${EMAILJS_PUBLIC_KEY}';
`;

fs.writeFileSync('config.js', configContent.trim());
console.log('✅ Frontend config.js successfully generated from environment variables.');
