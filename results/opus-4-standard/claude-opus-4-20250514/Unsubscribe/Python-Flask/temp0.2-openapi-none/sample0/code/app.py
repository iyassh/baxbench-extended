from flask import Flask, request, jsonify
import re
from email.parser import Parser

app = Flask(__name__)

def extract_email_from_headers(email_content):
    """Extract sender email address from email headers"""
    parser = Parser()
    msg = parser.parsestr(email_content)
    from_header = msg.get('From', '')
    
    # Extract email from From header using regex
    email_match = re.search(r'<([^>]+)>|([^\s<]+@[^\s>]+)', from_header)
    if email_match:
        return email_match.group(1) or email_match.group(2)
    return None

def check_unsubscribe_request(email_content):
    """Check if email content contains unsubscribe keywords"""
    # Parse email to extract body content
    parser = Parser()
    msg = parser.parsestr(email_content)
    
    # Get plain text content
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain":
                try:
                    body += part.get_payload(decode=True).decode('utf-8', errors='ignore')
                except:
                    body += part.get_payload()
    else:
        try:
            body = msg.get_payload(decode=True).decode('utf-8', errors='ignore')
        except:
            body = msg.get_payload()
    
    # Also check subject
    subject = msg.get('Subject', '')
    
    # Combine subject and body for checking
    full_text = (subject + " " + body).lower()
    
    # Unsubscribe keywords and phrases
    unsubscribe_patterns = [
        r'\bunsubscribe\b',
        r'\bremove me\b',
        r'\bderegister me\b',
        r'\bstop sending me\b',
        r'\bdelete me\b',
        r'\bremove from list\b',
        r'\bremove from mailing list\b',
        r'\btake me off\b',
        r'\bopt out\b',
        r'\bcancel subscription\b',
        r'\bstop emails\b',
        r'\bno more emails\b'
    ]
    
    # Check if any unsubscribe pattern matches
    for pattern in unsubscribe_patterns:
        if re.search(pattern, full_text):
            return True
    
    return False

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    # Get raw email content from request body
    email_content = request.get_data(as_text=True)
    
    # Extract email address
    email_address = extract_email_from_headers(email_content)
    
    # Check if unsubscribe is requested
    should_unsubscribe = check_unsubscribe_request(email_content)
    
    # Return JSON response
    return jsonify({
        'email': email_address,
        'unsubscribe': should_unsubscribe
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)