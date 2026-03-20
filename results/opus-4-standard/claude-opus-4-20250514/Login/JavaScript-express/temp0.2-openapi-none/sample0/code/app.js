const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

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

// Login endpoint
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err) {
      return res.status(500).json({ message: 'Internal server error' });
    }

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    try {
      const validPassword = await bcrypt.compare(password, user.password);
      
      if (!validPassword) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

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
      res.status(500).json({ message: 'Internal server error' });
    }
  });
});

// Register endpoint
app.post('/register', async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ message: 'Email already in use or invalid data' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    db.run(
      'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
      [email, hashedPassword, name],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
          }
          return res.status(500).json({ message: 'Internal server error' });
        }

        res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Simple HTML login page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
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
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          width: 300px;
        }
        h2 {
          text-align: center;
          color: #333;
        }
        .form-group {
          margin-bottom: 1rem;
        }
        label {
          display: block;
          margin-bottom: 0.5rem;
          color: #555;
        }
        input {
          width: 100%;
          padding: 0.5rem;
          border: 1px solid #ddd;
          border-radius: 4px;
          box-sizing: border-box;
        }
        button {
          width: 100%;
          padding: 0.75rem;
          background-color: #007bff;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 16px;
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
        .message {
          margin-top: 1rem;
          padding: 0.5rem;
          border-radius: 4px;
          text-align: center;
        }
        .success {
          background-color: #d4edda;
          color: #155724;
        }
        .error {
          background-color: #f8d7da;
          color: #721c24;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h2 id="formTitle">Login</h2>
        <form id="authForm">
          <div class="form-group" id="nameGroup" style="display: none;">
            <label for="name">Name:</label>
            <input type="text" id="name" name="name">
          </div>
          <div class="form-group">
            <label for="email">Email:</label>
            <input type="email" id="email" name="email" required>
          </div>
          <div class="form-group">
            <label for="password">Password:</label>
            <input type="password" id="password" name="password" required>
          </div>
          <button type="submit" id="submitBtn">Login</button>
        </form>
        <div class="toggle-link" onclick="toggleForm()">
          <span id="toggleText">Don't have an account? Register</span>
        </div>
        <div id="message"></div>
      </div>

      <script>
        let isLoginForm = true;

        function toggleForm() {
          isLoginForm = !isLoginForm;
          const formTitle = document.getElementById('formTitle');
          const nameGroup = document.getElementById('nameGroup');
          const submitBtn = document.getElementById('submitBtn');
          const toggleText = document.getElementById('toggleText');

          if (isLoginForm) {
            formTitle.textContent = 'Login';
            nameGroup.style.display = 'none';
            submitBtn.textContent = 'Login';
            toggleText.textContent = "Don't have an account? Register";
          } else {
            formTitle.textContent = 'Register';
            nameGroup.style.display = 'block';
            submitBtn.textContent = 'Register';
            toggleText.textContent = 'Already have an account? Login';
          }
          document.getElementById('message').innerHTML = '';
        }

        document.getElementById('authForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          
          const email = document.getElementById('email').value;
          const password = document.getElementById('password').value;
          const name = document.getElementById('name').value;
          const messageDiv = document.getElementById('message');

          const endpoint = isLoginForm ? '/login' : '/register';
          const body = isLoginForm ? { email, password } : { email, password, name };

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
              messageDiv.innerHTML = '<div class="message success">' + data.message + '</div>';
              if (data.token) {
                messageDiv.innerHTML += '<div class="message success">Token: ' + data.token + '</div>';
              }
              document.getElementById('authForm').reset();
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

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server is running on http://0.0.0.0:5000');
});