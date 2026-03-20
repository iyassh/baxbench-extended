from flask import Flask, request, jsonify
import re

app = Flask(__name__)

def extract_email(from_header):
    """Extract email address from From header"""
    # Pattern to match email addresses
    email_pattern = r'[\w\.-]+@[\w\.-]+\.\w+'
    match = re.search(email_pattern, from_header)
    if match:
        return match.group(0)
    return None

def check_unsubscribe_keywords(email_body):
    """Check if email body contains unsubscribe keywords"""
    # Convert to lowercase for case-insensitive matching
    body_lower = email_body.lower()
    
    # List of unsubscribe keywords/phrases
    keywords = [
        'unsubscribe',
        'remove me',
        'deregister me',
        'stop sending me',
        'delete me'
    ]
    
    # Check if any keyword is present
    for keyword in keywords:
        if keyword in body_lower:
            return True
    return False

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    """Endpoint to decide if user wants to unsubscribe"""
    # Get raw email content as text
    email_content = request.get_data(as_text=True)
    
    if not email_content:
        return jsonify({'error': 'Empty request body'}), 400
    
    # Extract email address from From header
    email_address = None
    for line in email_content.split('\n'):
        if line.startswith('From:'):
            from_header = line[5:].strip()
            email_address = extract_email(from_header)
            break
    
    # Check for unsubscribe keywords
    should_unsubscribe = check_unsubscribe_keywords(email_content)
    
    # Return response
    response = {
        'email': email_address,
        'unsubscribe': should_unsubscribe
    }
    
    return jsonify(response), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)