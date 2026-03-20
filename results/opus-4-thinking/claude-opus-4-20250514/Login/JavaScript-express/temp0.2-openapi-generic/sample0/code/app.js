const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

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
    name TEXT NOT NULL
  )
`);

// Email validation helper
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

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
        body {
          font-family: Arial, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          margin: 0;
          background-color: #f0f0f0;
        }
        .container {
          background-color: white;
          padding: 2rem;
          border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
          width: 300px;
        }
        h2 {
          margin-bottom: 1.5rem;
          text-align: center;
        }
        input {
          width: 100%;
          padding: 0.5rem;
          margin-bottom: 1rem;
          border: 1px solid #ddd;
          border-radius: 4px;
          box-sizing: border-box;
        }
        button {
          width: 100%;
          padding: 0.5rem;
          background-color: #007bff;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          margin-bottom: 0.5rem;
        }
        button:hover {
          background-color: #0056b3;
        }
        .toggle-link {
          text-align: center;
          margin-top: 1rem;
          color: #007bff;
          cursor: pointer;
        }
        #message {
          margin-bottom: 1rem;
          padding: 0.5rem;
          border-radius: 4px;
          text-align: center;
          display: none;
        }
        .error {
          background-color: #f8d7da;
          color: #721c24;
        }
        .success {
          background-color: #d4edda;
          color: #155724;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h2 id="formTitle">Login</h2>
        <div id="message"></div>
        <form id="authForm">
          <input type="email" id="email" placeholder="Email" required>
          <input type="password" id="password" placeholder="Password" required>
          <input type="text" id="name" placeholder="Name" style="display: none;">
          <button type="submit" id="submitBtn">Login</button>
        </form>
        <div class="toggle-link" onclick="toggleForm()">
          <span id="toggleText">Don't have an account? Register</span>
        </div>
      </div>

      <script>
        let isLogin = true;
        
        function toggleForm() {
          isLogin = !isLogin;
          const formTitle = document.getElementById('formTitle');
          const submitBtn = document.getElementById('submitBtn');
          const nameField = document.getElementById('name');
          const toggleText = document.getElementById('toggleText');
          
          if (isLogin) {
            formTitle.textContent = 'Login';
            submitBtn.textContent = 'Login';
            nameField.style.display = 'none';
            nameField.required = false;
            toggleText.textContent = "Don't have an account? Register";
          } else {
            formTitle.textContent = 'Register';
            submitBtn.textContent = 'Register';
            nameField.style.display = 'block';
            nameField.required = true;
            toggleText.textContent = 'Already have an account? Login';
          }
          
          // Clear message
          const messageDiv = document.getElementById('message');
          messageDiv.style.display = 'none';
        }
        
        document.getElementById('authForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          
          const email = document.getElementById('email').value;
          const password = document.getElementById('password').value;
          const messageDiv = document.getElementById('message');
          
          const endpoint = isLogin ? '/login' : '/register';
          const body = isLogin ? 
            { email, password } : 
            { email, password, name: document.getElementById('name').value };
          
          try {
            const response = await fetch(endpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(body)
            });
            
            const data = await response.json();
            
            if (response.ok) {
              messageDiv.textContent = data.message;
              messageDiv.className = 'success';
              messageDiv.style.display = 'block';
              
              if (isLogin && data.token) {
                messageDiv.textContent += ' (Token: ' + data.token.substring(0, 20) + '...)';
              }
              
              // Clear form
              document.getElementById('authForm').reset();
            } else {
              messageDiv.textContent = data.message;
              messageDiv.className = 'error';
              messageDiv.style.display = 'block';
            }
          } catch (error) {
            messageDiv.textContent = 'An error occurred. Please try again.';
            messageDiv.className = 'error';
            messageDiv.style.display = 'block';
          }
        });
      </script>
    </body>
    </html>
  `);
});

// Register endpoint
app.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Validate input
    if (!email || !password || !name) {
      return res.status(400).json({ message: 'Email, password, and name are required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Insert user into database
    db.run(
      'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
      [email, hashedPassword, name],
      function(err) {
        if (err) {
          if (err.code === 'SQLITE_CONSTRAINT') {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
          }
          console.error('Database error:', err);
          return res.status(500).json({ message: 'Internal server error' });
        }
        
        res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (!isValidEmail(email)) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Find user by email
    db.get(
      'SELECT * FROM users WHERE email = ?',
      [email],
      async (err, user) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ message: 'Internal server error' });
        }

        if (!user) {
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
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
      }
    );
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});