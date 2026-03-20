const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';
const SALT_ROUNDS = 10;

// Middleware
app.use(express.json());
app.use(express.static('public'));

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
`);

// Serve login page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Login Page</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          max-width: 400px;
          margin: 50px auto;
          padding: 20px;
        }
        .form-container {
          background: #f4f4f4;
          padding: 20px;
          border-radius: 5px;
        }
        input {
          width: 100%;
          padding: 10px;
          margin: 10px 0;
          box-sizing: border-box;
        }
        button {
          width: 100%;
          padding: 10px;
          background: #007bff;
          color: white;
          border: none;
          border-radius: 3px;
          cursor: pointer;
        }
        button:hover {
          background: #0056b3;
        }
        .toggle-link {
          text-align: center;
          margin-top: 15px;
        }
        .message {
          padding: 10px;
          margin: 10px 0;
          border-radius: 3px;
        }
        .error {
          background: #f8d7da;
          color: #721c24;
        }
        .success {
          background: #d4edda;
          color: #155724;
        }
      </style>
    </head>
    <body>
      <div class="form-container">
        <h2 id="form-title">Login</h2>
        <div id="message"></div>
        <form id="auth-form">
          <input type="email" id="email" placeholder="Email" required>
          <input type="password" id="password" placeholder="Password" required>
          <div id="name-field" style="display: none;">
            <input type="text" id="name" placeholder="Name">
          </div>
          <button type="submit" id="submit-btn">Login</button>
        </form>
        <div class="toggle-link">
          <a href="#" id="toggle-form">Don't have an account? Register</a>
        </div>
      </div>

      <script>
        let isLoginMode = true;
        const form = document.getElementById('auth-form');
        const toggleLink = document.getElementById('toggle-form');
        const formTitle = document.getElementById('form-title');
        const submitBtn = document.getElementById('submit-btn');
        const nameField = document.getElementById('name-field');
        const messageDiv = document.getElementById('message');

        toggleLink.addEventListener('click', (e) => {
          e.preventDefault();
          isLoginMode = !isLoginMode;
          
          if (isLoginMode) {
            formTitle.textContent = 'Login';
            submitBtn.textContent = 'Login';
            nameField.style.display = 'none';
            toggleLink.textContent = "Don't have an account? Register";
          } else {
            formTitle.textContent = 'Register';
            submitBtn.textContent = 'Register';
            nameField.style.display = 'block';
            toggleLink.textContent = 'Already have an account? Login';
          }
          messageDiv.innerHTML = '';
        });

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          
          const email = document.getElementById('email').value;
          const password = document.getElementById('password').value;
          const name = document.getElementById('name').value;
          
          const endpoint = isLoginMode ? '/login' : '/register';
          const body = isLoginMode 
            ? { email, password }
            : { email, password, name };
          
          try {
            const response = await fetch(endpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(body)
            });
            
            const data = await response.json();
            
            if (response.ok) {
              messageDiv.innerHTML = '<div class="message success">' + data.message + '</div>';
              if (data.token) {
                messageDiv.innerHTML += '<div class="message success">Token: ' + data.token + '</div>';
              }
              form.reset();
            } else {
              messageDiv.innerHTML = '<div class="message error">' + data.message + '</div>';
            }
          } catch (error) {
            messageDiv.innerHTML = '<div class="message error">An error occurred. Please try again.</div>';
          }
        });
      </script>
    </body>
    </html>
  `);
});

// Login endpoint
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  // Email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err) {
      return res.status(500).json({ message: 'Server error' });
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
      res.status(500).json({ message: 'Server error' });
    }
  });
});

// Register endpoint
app.post('/register', async (req, res) => {
  const { email, password, name } = req.body;

  // Validate input
  if (!email || !password || !name) {
    return res.status(400).json({ message: 'Email already in use or invalid data' });
  }

  // Email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: 'Email already in use or invalid data' });
  }

  // Password validation (minimum 6 characters)
  if (password.length < 6) {
    return res.status(400).json({ message: 'Email already in use or invalid data' });
  }

  // Name validation
  if (name.trim().length === 0) {
    return res.status(400).json({ message: 'Email already in use or invalid data' });
  }

  try {
    // Hash password
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // Insert user into database
    db.run(
      'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
      [email, hashedPassword, name],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
          }
          return res.status(500).json({ message: 'Server error' });
        }

        res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});