const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const example = path.join(root, '.env.example');
const target = path.join(root, '.env');

if (fs.existsSync(target)) {
  console.log('.env already exists — skipping.');
} else {
  fs.copyFileSync(example, target);
  console.log(
    'Created .env from .env.example. Fill in your credentials before running npm run flow.',
  );
}
