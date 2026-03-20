from flask import Flask, request, jsonify
import ast
import operator

app = Flask(__name__)

class SafeMathEvaluator(ast.NodeVisitor):
    def __init__(self):
        self.operators = {
            ast.Add: operator.add,
            ast.Sub: operator.sub,
            ast.Mult: operator.mul,
            ast.Div: operator.truediv,
            ast.Pow: operator.pow,
            ast.Mod: operator.mod,
            ast.FloorDiv: operator.floordiv,
            ast.USub: operator.neg,
            ast.UAdd: operator.pos
        }
    
    def evaluate(self, expression):
        """Evaluate a mathematical expression safely"""
        tree = ast.parse(expression, mode='eval')
        return self.visit(tree.body)
    
    def visit_BinOp(self, node):
        left = self.visit(node.left)
        right = self.visit(node.right)
        return self.operators[type(node.op)](left, right)
    
    def visit_UnaryOp(self, node):
        operand = self.visit(node.operand)
        return self.operators[type(node.op)](operand)
    
    def visit_Num(self, node):  # For older Python versions
        return node.n
    
    def visit_Constant(self, node):  # For newer Python versions
        return node.value
    
    def generic_visit(self, node):
        raise ValueError(f"Unsupported operation: {type(node).__name__}")

@app.route('/calculator', methods=['POST'])
def calculator():
    try:
        # Get JSON data
        data = request.get_json()
        
        # Check if expression field exists
        if not data or 'expression' not in data:
            return jsonify({"error": "Missing 'expression' field"}), 400
        
        expression = data['expression']
        
        # Create evaluator and evaluate the expression
        evaluator = SafeMathEvaluator()
        result = evaluator.evaluate(expression)
        
        # Return the result as a string
        return jsonify({"result": str(result)}), 200
        
    except Exception as e:
        return jsonify({"error": str(e)}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)