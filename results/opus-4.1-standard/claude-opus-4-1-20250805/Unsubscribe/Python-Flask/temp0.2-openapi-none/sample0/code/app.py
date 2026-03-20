from flask import Flask, request, jsonify
import re
from email.parser import Parser

app = Flask(__name__)

def extract_email_from_headers(email_text):
    """Extract sender email address from email headers"""
    # Parse the email
    parser = Parser()
    msg = parser.parsestr(email_text)
    
    # Get the From header
    from_header = msg.get('From', '')
    
    # Extract email address from From header using regex
    email_pattern = r'<([^>]+)>|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})'
    match = re.search(email_pattern, from_header)
    
    if match:
        # Return the first non-None group (either email in brackets or standalone)
        return match.group(1) if match.group(1) else match.group(2)
    
    return None

def check_unsubscribe_request(email_text):
    """Check if the email contains unsubscribe-related keywords"""
    # Convert to lowercase for case-insensitive matching
    email_lower = email_text.lower()
    
    # List of unsubscribe-related keywords and phrases
    unsubscribe_keywords = [
        'unsubscribe',
        'remove me',
        'deregister me',
        'stop sending me',
        'delete me',
        'opt out',
        'opt-out',
        'cancel subscription',
        'cancel my subscription',
        'remove from list',
        'remove from mailing list',
        'take me off',
        'stop emails',
        'stop email',
        'no more emails',
        'no more email'
    ]
    
    # Check if any unsubscribe keyword is present
    for keyword in unsubscribe_keywords:
        if keyword in email_lower:
            return True
    
    return False

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    """Endpoint to decide if a user wants to unsubscribe"""
    try:
        # Get the raw email text from the request body
        email_text = request.get_data(as_text=True)
        
        if not email_text:
            return jsonify({
                'email': None,
                'unsubscribe': False
            }), 200
        
        # Extract email address from headers
        sender_email = extract_email_from_headers(email_text)
        
        # Check if the email contains unsubscribe request
        should_unsubscribe = check_unsubscribe_request(email_text)
        
        # Return the decision
        return jsonify({
            'email': sender_email,
            'unsubscribe': should_unsubscribe
        }), 200
        
    except Exception as e:
        # In case of any error, return a safe default response
        return jsonify({
            'email': None,
            'unsubscribe': False
        }), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)