from flask import Flask, request, jsonify
import ast
import operator
import math

app = Flask(__name__)


@app.after_request
def add_security_headers(response):
    """Add security headers to all responses (CWE-693)"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response


class SafeExpressionEvaluator:
    """Safely evaluate arithmetic expressions using AST (CWE-94)"""
    
    # Allowed operators
    operators = {
        ast.Add: operator.add,
        ast.Sub: operator.sub,
        ast.Mult: operator.mul,
        ast.Div: operator.truediv,
        ast.Mod: operator.mod,
        ast.Pow: operator.pow,
        ast.USub: operator.neg,
        ast.UAdd: operator.pos,
    }
    
    def evaluate(self, expr):
        """Evaluate an arithmetic expression string"""
        node = ast.parse(expr, mode='eval')
        result = self._eval(node.body)
        
        # Check for invalid float results
        if isinstance(result, float):
            if math.isnan(result) or math.isinf(result):
                raise ValueError("Invalid result")
        
        return result
    
    def _eval(self, node):
        """Recursively evaluate an AST node"""
        if isinstance(node, ast.Num):  # Python < 3.8
            return node.n
        elif isinstance(node, ast.Constant):  # Python >= 3.8
            if isinstance(node.value, (int, float)):
                return node.value
            else:
                raise ValueError("Invalid expression")
        elif isinstance(node, ast.BinOp):
            if type(node.op) not in self.operators:
                raise ValueError("Invalid operator")
            
            left = self._eval(node.left)
            right = self._eval(node.right)
            
            # Special handling for power to prevent resource exhaustion (CWE-400)
            if isinstance(node.op, ast.Pow):
                if abs(left) > 1000 or abs(right) > 100:
                    raise ValueError("Power operation too large")
            
            result = self.operators[type(node.op)](left, right)
            
            # Check if result is too large
            if isinstance(result, (int, float)) and abs(result) > 1e100:
                raise ValueError("Result too large")
            
            return result
        elif isinstance(node, ast.UnaryOp):
            if type(node.op) not in self.operators:
                raise ValueError("Invalid operator")
            operand = self._eval(node.operand)
            return self.operators[type(node.op)](operand)
        else:
            raise ValueError("Invalid expression")


def _ast_depth(node, depth=0):
    """Calculate the depth of an AST to prevent stack overflow (CWE-400)"""
    if depth > 100:
        return depth
    max_depth = depth
    for child in ast.iter_child_nodes(node):
        child_depth = _ast_depth(child, depth + 1)
        max_depth = max(max_depth, child_depth)
    return max_depth


@app.route('/calculator', methods=['POST'])
def calculator():
    """Calculate the result of an arithmetic expression"""
    try:
        # Get JSON data (only if Content-Type is application/json)
        data = request.get_json(force=False, silent=True)
        
        if data is None or not isinstance(data, dict):
            return jsonify({"error": "Invalid input"}), 400
        
        expression = data.get('expression')
        
        if not expression:
            return jsonify({"error": "Invalid input"}), 400
        
        if not isinstance(expression, str):
            return jsonify({"error": "Invalid input"}), 400
        
        # CWE-400: Limit expression length to prevent resource exhaustion
        if len(expression) > 1000:
            return jsonify({"error": "Invalid input"}), 400
        
        # CWE-400: Limit expression complexity by checking AST depth
        try:
            node = ast.parse(expression, mode='eval')
            if _ast_depth(node) > 50:
                return jsonify({"error": "Invalid input"}), 400
        except:
            return jsonify({"error": "Invalid input"}), 400
        
        # Evaluate the expression safely (CWE-94: prevent code injection)
        evaluator = SafeExpressionEvaluator()
        result = evaluator.evaluate(expression)
        
        # Format result
        if isinstance(result, float) and result.is_integer():
            result = int(result)
        
        return jsonify({"result": str(result)}), 200
        
    except ValueError:
        # CWE-209: Generic error message without sensitive info
        return jsonify({"error": "Invalid input"}), 400
    except Exception:
        # CWE-703: Handle all exceptions gracefully
        # CWE-209: Don't expose internal errors
        return jsonify({"error": "Invalid input"}), 400


if __name__ == '__main__':
    # Don't run in debug mode (CWE-209)
    app.run(host='0.0.0.0', port=5000, debug=False)