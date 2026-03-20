const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key-change-in-production';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create users table if it doesn't exist
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`, (err) => {
  if (err) {
    console.error('Error creating users table:', err);
  } else {
    console.log('Users table ready');
  }
});

// Serve login page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Login Page</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: Arial, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
        }
        .container {
          background: white;
          padding: 2rem;
          border-radius: 10px;
          box-shadow: 0 10px 25px rgba(0,0,0,0.1);
          width: 100%;
          max-width: 400px;
        }
        h2 {
          text-align: center;
          margin-bottom: 1.5rem;
          color: #333;
        }
        .form-group {
          margin-bottom: 1rem;
        }
        label {
          display: block;
          margin-bottom: 0.5rem;
          color: #555;
          font-weight: 500;
        }
        input {
          width: 100%;
          padding: 0.75rem;
          border: 1px solid #ddd;
          border-radius: 5px;
          font-size: 1rem;
          transition: border-color 0.3s;
        }
        input:focus {
          outline: none;
          border-color: #667eea;
        }
        button {
          width: 100%;
          padding: 0.75rem;
          background: #667eea;
          color: white;
          border: none;
          border-radius: 5px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.3s;
        }
        button:hover {
          background: #5a67d8;
        }
        .toggle-form {
          text-align: center;
          margin-top: 1rem;
          color: #666;
        }
        .toggle-form a {
          color: #667eea;
          text-decoration: none;
          font-weight: 600;
        }
        .toggle-form a:hover {
          text-decoration: underline;
        }
        .message {
          padding: 0.75rem;
          border-radius: 5px;
          margin-bottom: 1rem;
          text-align: center;
        }
        .success {
          background: #d4edda;
          color: #155724;
          border: 1px solid #c3e6cb;
        }
        .error {
          background: #f8d7da;
          color: #721c24;
          border: 1px solid #f5c6cb;
        }
        .hidden {
          display: none;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div id="loginForm">
          <h2>Login</h2>
          <div id="loginMessage" class="message hidden"></div>
          <form onsubmit="handleLogin(event)">
            <div class="form-group">
              <label for="loginEmail">Email</label>
              <input type="email" id="loginEmail" required placeholder="user@example.com">
            </div>
            <div class="form-group">
              <label for="loginPassword">Password</label>
              <input type="password" id="loginPassword" required placeholder="Enter your password">
            </div>
            <button type="submit">Login</button>
          </form>
          <div class="toggle-form">
            Don't have an account? <a href="#" onclick="toggleForms()">Register</a>
          </div>
        </div>

        <div id="registerForm" class="hidden">
          <h2>Register</h2>
          <div id="registerMessage" class="message hidden"></div>
          <form onsubmit="handleRegister(event)">
            <div class="form-group">
              <label for="registerName">Name</label>
              <input type="text" id="registerName" required placeholder="John Doe">
            </div>
            <div class="form-group">
              <label for="registerEmail">Email</label>
              <input type="email" id="registerEmail" required placeholder="newuser@example.com">
            </div>
            <div class="form-group">
              <label for="registerPassword">Password</label>
              <input type="password" id="registerPassword" required placeholder="Create a password">
            </div>
            <button type="submit">Register</button>
          </form>
          <div class="toggle-form">
            Already have an account? <a href="#" onclick="toggleForms()">Login</a>
          </div>
        </div>
      </div>

      <script>
        function toggleForms() {
          const loginForm = document.getElementById('loginForm');
          const registerForm = document.getElementById('registerForm');
          loginForm.classList.toggle('hidden');
          registerForm.classList.toggle('hidden');
          
          // Clear messages
          document.getElementById('loginMessage').classList.add('hidden');
          document.getElementById('registerMessage').classList.add('hidden');
        }

        async function handleLogin(event) {
          event.preventDefault();
          const email = document.getElementById('loginEmail').value;
          const password = document.getElementById('loginPassword').value;
          const messageDiv = document.getElementById('loginMessage');

          try {
            const response = await fetch('/login', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ email, password }),
            });

            const data = await response.json();

            if (response.ok) {
              messageDiv.className = 'message success';
              messageDiv.textContent = data.message + ' (Token: ' + data.token.substring(0, 20) + '...)';
              messageDiv.classList.remove('hidden');
              
              // Clear form
              document.getElementById('loginEmail').value = '';
              document.getElementById('loginPassword').value = '';
            } else {
              messageDiv.className = 'message error';
              messageDiv.textContent = data.message;
              messageDiv.classList.remove('hidden');
            }
          } catch (error) {
            messageDiv.className = 'message error';
            messageDiv.textContent = 'An error occurred. Please try again.';
            messageDiv.classList.remove('hidden');
          }
        }

        async function handleRegister(event) {
          event.preventDefault();
          const name = document.getElementById('registerName').value;
          const email = document.getElementById('registerEmail').value;
          const password = document.getElementById('registerPassword').value;
          const messageDiv = document.getElementById('registerMessage');

          try {
            const response = await fetch('/register', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ name, email, password }),
            });

            const data = await response.json();

            if (response.ok) {
              messageDiv.className = 'message success';
              messageDiv.textContent = data.message;
              messageDiv.classList.remove('hidden');
              
              // Clear form
              document.getElementById('registerName').value = '';
              document.getElementById('registerEmail').value = '';
              document.getElementById('registerPassword').value = '';
              
              // Switch to login form after 2 seconds
              setTimeout(() => {
                toggleForms();
              }, 2000);
            } else {
              messageDiv.className = 'message error';
              messageDiv.textContent = data.message;
              messageDiv.classList.remove('hidden');
            }
          } catch (error) {
            messageDiv.className = 'message error';
            messageDiv.textContent = 'An error occurred. Please try again.';
            messageDiv.classList.remove('hidden');
          }
        }
      </script>
    </body>
    </html>
  `);
});

// Login endpoint
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    try {
      const validPassword = await bcrypt.compare(password, user.password);
      
      if (!validPassword) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      // Generate JWT token
      const token = jwt.sign(
        { id: user.id, email: user.email },
        APP_SECRET,
        { expiresIn: '24h' }
      );

      res.status(200).json({
        token: token,
        message: 'Login successful'
      });
    } catch (error) {
      console.error('Password comparison error:', error);
      res.status(401).json({ message: 'Invalid email or password' });
    }
  });
});

// Register endpoint
app.post('/register', async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ message: 'Email already in use or invalid data' });
  }

  // Check if user already exists
  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, existingUser) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    if (existingUser) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    try {
      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Insert new user
      db.run(
        'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
        [email, hashedPassword, name],
        function(err) {
          if (err) {
            console.error('Insert error:', err);
            return res.status(400).json({ message: 'Email already in use or invalid data' });
          }

          res.status(201).json({ message: 'Registration successful' });
        }
      );
    } catch (error) {
      console.error('Hashing error:', error);
      res.status(400).json({ message: 'Email already in use or invalid data' });
    }
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});