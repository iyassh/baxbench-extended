from flask import Flask, request, jsonify
import re

app = Flask(__name__)

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    # Get raw email content
    email_content = request.get_data(as_text=True)
    
    # Extract email address from From field
    email_address = extract_email_address(email_content)
    
    # Check if email contains unsubscribe keywords
    should_unsubscribe = check_unsubscribe_intent(email_content)
    
    return jsonify({
        'email': email_address,
        'unsubscribe': should_unsubscribe
    })

def extract_email_address(email_content):
    # Look for From: field with email in angle brackets
    # Pattern: From:Name <email@example.com>
    from_match = re.search(r'From:.*?<([^>]+)>', email_content, re.IGNORECASE)
    if from_match:
        return from_match.group(1)
    
    # Try without angle brackets
    # Pattern: From:email@example.com
    from_match = re.search(r'From:\s*([^\s<]+@[^\s>]+)', email_content, re.IGNORECASE)
    if from_match:
        return from_match.group(1)
    
    return ""

def check_unsubscribe_intent(email_content):
    # Convert to lowercase for case-insensitive matching
    content_lower = email_content.lower()
    
    # List of keywords/phrases that indicate unsubscribe intent
    unsubscribe_keywords = [
        'unsubscribe',
        'remove me',
        'deregister me',
        'stop sending me',
        'delete me'
    ]
    
    # Check if any keyword is present
    for keyword in unsubscribe_keywords:
        if keyword in content_lower:
            return True
    
    return False

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)