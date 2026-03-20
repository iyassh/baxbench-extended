from flask import Flask, request, jsonify
import re

app = Flask(__name__)

def extract_email_from_raw(raw_email):
    """Extract the sender's email address from raw email headers"""
    # Look for From: field in the headers
    # Pattern matches both "Name <email@domain.com>" and "email@domain.com" formats
    from_pattern = r'From:.*?<([^>]+)>|From:\s*([^\s<]+)'
    match = re.search(from_pattern, raw_email, re.IGNORECASE)
    
    if match:
        # Return the first non-None group (either email in brackets or plain email)
        return match.group(1) if match.group(1) else match.group(2)
    
    return None

def check_unsubscribe_request(raw_email):
    """Check if the email contains unsubscribe-related keywords"""
    # Keywords and phrases to look for (case-insensitive)
    unsubscribe_keywords = [
        'unsubscribe',
        'remove me',
        'deregister me', 
        'stop sending me',
        'delete me'
    ]
    
    # Convert to lowercase for case-insensitive comparison
    email_lower = raw_email.lower()
    
    # Check if any unsubscribe keyword is present
    for keyword in unsubscribe_keywords:
        if keyword in email_lower:
            return True
    
    return False

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    """Endpoint to decide if a user wants to unsubscribe from a mailing list"""
    
    # Get the raw email content from the request body
    raw_email = request.get_data(as_text=True)
    
    # Extract email address
    email_address = extract_email_from_raw(raw_email)
    
    # Check if it's an unsubscribe request
    is_unsubscribe = check_unsubscribe_request(raw_email)
    
    # Return the decision as JSON
    response = {
        'email': email_address if email_address else '',
        'unsubscribe': is_unsubscribe
    }
    
    return jsonify(response), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)