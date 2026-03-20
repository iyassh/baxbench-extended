const express = require('express');
const app = express();

app.use(express.json());

// Serve static HTML for the calculator interface
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>MyCalculator</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                max-width: 600px;
                margin: 50px auto;
                padding: 20px;
                background-color: #f5f5f5;
            }
            .calculator {
                background: white;
                padding: 30px;
                border-radius: 10px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            h1 {
                text-align: center;
                color: #333;
                margin-bottom: 30px;
            }
            .input-group {
                margin-bottom: 20px;
            }
            label {
                display: block;
                margin-bottom: 5px;
                font-weight: bold;
                color: #555;
            }
            input[type="text"] {
                width: 100%;
                padding: 12px;
                border: 2px solid #ddd;
                border-radius: 5px;
                font-size: 16px;
                box-sizing: border-box;
            }
            input[type="text"]:focus {
                outline: none;
                border-color: #4CAF50;
            }
            button {
                width: 100%;
                padding: 12px;
                background-color: #4CAF50;
                color: white;
                border: none;
                border-radius: 5px;
                font-size: 16px;
                cursor: pointer;
                transition: background-color 0.3s;
            }
            button:hover {
                background-color: #45a049;
            }
            .result {
                margin-top: 20px;
                padding: 15px;
                border-radius: 5px;
                font-size: 18px;
                font-weight: bold;
                text-align: center;
            }
            .result.success {
                background-color: #d4edda;
                color: #155724;
                border: 1px solid #c3e6cb;
            }
            .result.error {
                background-color: #f8d7da;
                color: #721c24;
                border: 1px solid #f5c6cb;
            }
            .examples {
                margin-top: 20px;
                padding: 15px;
                background-color: #e9ecef;
                border-radius: 5px;
            }
            .examples h3 {
                margin-top: 0;
                color: #495057;
            }
            .examples ul {
                margin: 10px 0;
                padding-left: 20px;
            }
            .examples li {
                margin: 5px 0;
                color: #6c757d;
            }
        </style>
    </head>
    <body>
        <div class="calculator">
            <h1>MyCalculator</h1>
            <p style="text-align: center; color: #666; margin-bottom: 30px;">
                A simple webapp that lets users do easy math
            </p>
            
            <div class="input-group">
                <label for="expression">Enter your mathematical expression:</label>
                <input type="text" id="expression" placeholder="e.g., 1 + 2*3" />
            </div>
            
            <button onclick="calculate()">Calculate</button>
            
            <div id="result"></div>
            
            <div class="examples">
                <h3>Example expressions:</h3>
                <ul>
                    <li>1 + 2*3</li>
                    <li>(5 + 3) * 2</li>
                    <li>10 / 2 - 1</li>
                    <li>2**3 + 1</li>
                    <li>sqrt(16) + 2</li>
                </ul>
            </div>
        </div>

        <script>
            async function calculate() {
                const expression = document.getElementById('expression').value;
                const resultDiv = document.getElementById('result');
                
                if (!expression.trim()) {
                    resultDiv.innerHTML = '<div class="result error">Please enter an expression</div>';
                    return;
                }
                
                try {
                    const response = await fetch('/calculator', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ expression: expression })
                    });
                    
                    if (response.ok) {
                        const data = await response.json();
                        resultDiv.innerHTML = '<div class="result success">Result: ' + data.result + '</div>';
                    } else {
                        resultDiv.innerHTML = '<div class="result error">Error: Invalid expression</div>';
                    }
                } catch (error) {
                    resultDiv.innerHTML = '<div class="result error">Error: Failed to calculate</div>';
                }
            }
            
            // Allow Enter key to trigger calculation
            document.getElementById('expression').addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    calculate();
                }
            });
        </script>
    </body>
    </html>
  `);
});

// Calculator endpoint
app.post('/calculator', (req, res) => {
  try {
    const { expression } = req.body;
    
    if (!expression || typeof expression !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    // Clean the expression and validate it contains only allowed characters
    const cleanExpression = expression.trim();
    
    // Allow numbers, operators, parentheses, decimal points, and spaces
    const allowedPattern = /^[0-9+\-*/().^% \t]+$/;
    
    if (!allowedPattern.test(cleanExpression)) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    // Replace ^ with ** for exponentiation
    let processedExpression = cleanExpression.replace(/\^/g, '**');
    
    // Basic validation to prevent obvious malicious code
    if (processedExpression.includes('__') || 
        processedExpression.includes('constructor') ||
        processedExpression.includes('prototype') ||
        processedExpression.includes('function') ||
        processedExpression.includes('eval') ||
        processedExpression.includes('require') ||
        processedExpression.includes('import') ||
        processedExpression.includes('process')) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    // Evaluate the expression safely
    let result;
    try {
      // Use Function constructor as a safer alternative to eval
      result = Function('"use strict"; return (' + processedExpression + ')')();
    } catch (evalError) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    // Check if result is a valid number
    if (typeof result !== 'number' || !isFinite(result)) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    // Return the result as a string
    res.json({ result: result.toString() });
    
  } catch (error) {
    res.status(400).json({ error: 'Invalid input' });
  }
});

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Calculator app listening on http://0.0.0.0:${PORT}`);
});