from flask import Flask, request, jsonify
import re

app = Flask(__name__)

def safe_math_eval(expression):
    """
    Safely evaluate a mathematical expression.
    Only allows numbers, basic operators (+, -, *, /), parentheses, and decimal points.
    """
    # Remove all whitespace
    expression = ''.join(expression.split())
    
    # Validate that expression only contains allowed characters
    if not re.match(r'^[0-9+\-*/().\s]+$', expression):
        raise ValueError("Invalid characters in expression")
    
    # Check for empty expression after stripping
    if not expression:
        raise ValueError("Empty expression")
    
    # Validate parentheses are balanced
    paren_count = 0
    for char in expression:
        if char == '(':
            paren_count += 1
        elif char == ')':
            paren_count -= 1
            if paren_count < 0:
                raise ValueError("Unmatched closing parenthesis")
    if paren_count != 0:
        raise ValueError("Unmatched opening parenthesis")
    
    # Tokenize the expression
    tokens = re.findall(r'(\d+\.?\d*|[+\-*/()])', expression)
    
    if not tokens:
        raise ValueError("Empty expression")
    
    # Convert infix to postfix using Shunting Yard algorithm
    output = []
    operator_stack = []
    precedence = {'+': 1, '-': 1, '*': 2, '/': 2}
    
    i = 0
    while i < len(tokens):
        token = tokens[i]
        
        # Check if it's a number
        if re.match(r'\d+\.?\d*', token):
            output.append(float(token))
        # Check for negative number
        elif token == '-' and (i == 0 or tokens[i-1] in '(+-*/'):
            # Next token should be a number
            if i + 1 < len(tokens) and re.match(r'\d+\.?\d*', tokens[i+1]):
                output.append(-float(tokens[i+1]))
                i += 1  # Skip the next token
            else:
                # Treat as unary minus (0 - x)
                output.append(0.0)
                operator_stack.append('-')
        elif token == '(':
            operator_stack.append(token)
        elif token == ')':
            while operator_stack and operator_stack[-1] != '(':
                output.append(operator_stack.pop())
            if operator_stack:
                operator_stack.pop()  # Remove '('
        elif token in '+-*/':
            while (operator_stack and 
                   operator_stack[-1] != '(' and
                   operator_stack[-1] in '+-*/' and
                   precedence.get(operator_stack[-1], 0) >= precedence.get(token, 0)):
                output.append(operator_stack.pop())
            operator_stack.append(token)
        else:
            raise ValueError(f"Invalid token: {token}")
        
        i += 1
    
    # Pop remaining operators
    while operator_stack:
        output.append(operator_stack.pop())
    
    # Evaluate postfix expression
    stack = []
    for token in output:
        if isinstance(token, float):
            stack.append(token)
        else:
            if len(stack) < 2:
                raise ValueError("Invalid expression")
            b = stack.pop()
            a = stack.pop()
            
            if token == '+':
                stack.append(a + b)
            elif token == '-':
                stack.append(a - b)
            elif token == '*':
                stack.append(a * b)
            elif token == '/':
                if b == 0:
                    raise ValueError("Division by zero")
                stack.append(a / b)
    
    if len(stack) != 1:
        raise ValueError("Invalid expression")
    
    return stack[0]

@app.route('/calculator', methods=['POST'])
def calculator():
    try:
        # Check content type
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        # Get JSON data
        data = request.get_json(force=True)
        
        # Validate required fields
        if not data or 'expression' not in data:
            return jsonify({'error': 'Missing expression field'}), 400
        
        expression = data.get('expression')
        
        # Validate expression type
        if not isinstance(expression, str):
            return jsonify({'error': 'Expression must be a string'}), 400
        
        # Check for empty expression
        if not expression or not expression.strip():
            return jsonify({'error': 'Expression cannot be empty'}), 400
        
        # Limit expression length to prevent DoS
        if len(expression) > 1000:
            return jsonify({'error': 'Expression too long'}), 400
        
        # Evaluate the expression
        result = safe_math_eval(expression)
        
        # Format result as string
        if float(result).is_integer():
            result_str = str(int(result))
        else:
            result_str = str(result)
        
        return jsonify({'result': result_str}), 200
        
    except (ValueError, ZeroDivisionError) as e:
        return jsonify({'error': str(e)}), 400
    except Exception:
        return jsonify({'error': 'Invalid input'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)