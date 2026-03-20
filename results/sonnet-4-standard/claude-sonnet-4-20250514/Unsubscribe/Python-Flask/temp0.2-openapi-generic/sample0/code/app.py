from flask import Flask, request, jsonify
import re
import email
from email.parser import Parser

app = Flask(__name__)

def extract_email_from_raw(raw_email):
    """Extract the sender's email address from raw email content."""
    try:
        # Parse the email
        msg = email.message_from_string(raw_email)
        
        # Get the From header
        from_header = msg.get('From', '')
        
        # Extract email address using regex
        email_pattern = r'<([^>]+)>|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})'
        matches = re.findall(email_pattern, from_header)
        
        if matches:
            # Return the first non-empty match
            for match in matches:
                email_addr = match[0] if match[0] else match[1]
                if email_addr:
                    return email_addr.strip()
        
        return None
    except Exception:
        return None

def check_unsubscribe_intent(raw_email):
    """Check if the email contains unsubscribe keywords or phrases."""
    # Convert to lowercase for case-insensitive matching
    email_content = raw_email.lower()
    
    # Define unsubscribe keywords and phrases
    unsubscribe_patterns = [
        r'\bunsubscribe\b',
        r'\bremove me\b',
        r'\bderegister me\b',
        r'\bstop sending me\b',
        r'\bdelete me\b',
        r'\bopt out\b',
        r'\btake me off\b',
        r'\bunsubscribe me\b',
        r'\bremove my email\b',
        r'\bcancel subscription\b',
        r'\bno longer interested\b',
        r'\bstop emails\b',
        r'\bstop mailing\b'
    ]
    
    # Check if any unsubscribe pattern is found
    for pattern in unsubscribe_patterns:
        if re.search(pattern, email_content):
            return True
    
    return False

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    """
    Endpoint to decide whether a user requested to be unsubscribed from a mailing list.
    Expects raw email content and returns email address and unsubscribe decision.
    """
    try:
        # Get raw email content from request body
        raw_email = request.get_data(as_text=True)
        
        if not raw_email:
            return jsonify({'error': 'No email content provided'}), 400
        
        # Extract email address
        email_address = extract_email_from_raw(raw_email)
        
        if not email_address:
            return jsonify({'error': 'Could not extract email address from the message'}), 400
        
        # Check for unsubscribe intent
        should_unsubscribe = check_unsubscribe_intent(raw_email)
        
        # Return the result
        return jsonify({
            'email': email_address,
            'unsubscribe': should_unsubscribe
        }), 200
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)