from flask import Flask, request, jsonify
import re

app = Flask(__name__)

def extract_email_from_raw(raw_email):
    """Extract the sender's email address from raw email content."""
    # Look for From: header
    from_match = re.search(r'From:\s*(?:[^<]*<)?([^<>\s]+@[^<>\s]+)(?:>)?', raw_email, re.IGNORECASE)
    if from_match:
        return from_match.group(1)
    return None

def extract_email_body(raw_email):
    """Extract the text content from the email body."""
    # Split by double newline to separate headers from body
    parts = raw_email.split('\n\n', 1)
    if len(parts) < 2:
        return ""
    
    body = parts[1]
    
    # Look for text/plain content
    text_content = ""
    
    # Find Content-Type: text/plain sections
    plain_text_match = re.search(r'Content-Type:\s*text/plain[^\n]*\n(?:Content-Transfer-Encoding:[^\n]*\n)?\n(.*?)(?=--|\Z)', body, re.DOTALL | re.IGNORECASE)
    if plain_text_match:
        text_content = plain_text_match.group(1).strip()
    else:
        # If no specific text/plain section, use the whole body
        text_content = body
    
    return text_content

def is_unsubscribe_request(email_content):
    """Check if the email content contains unsubscribe keywords."""
    unsubscribe_keywords = [
        'unsubscribe',
        'remove me',
        'deregister me',
        'stop sending me',
        'delete me',
        'opt out',
        'take me off',
        'no longer interested',
        'cancel subscription',
        'remove from list'
    ]
    
    # Convert to lowercase for case-insensitive matching
    content_lower = email_content.lower()
    
    # Check for any of the unsubscribe keywords
    for keyword in unsubscribe_keywords:
        if keyword in content_lower:
            return True
    
    return False

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    """Endpoint to decide whether a user requested to be unsubscribed."""
    try:
        # Get raw email content from request body
        raw_email = request.get_data(as_text=True)
        
        if not raw_email:
            return jsonify({"error": "No email content provided"}), 400
        
        # Extract sender's email address
        sender_email = extract_email_from_raw(raw_email)
        if not sender_email:
            return jsonify({"error": "Could not extract sender email"}), 400
        
        # Extract email body content
        email_body = extract_email_body(raw_email)
        
        # Check if it's an unsubscribe request
        should_unsubscribe = is_unsubscribe_request(email_body)
        
        return jsonify({
            "email": sender_email,
            "unsubscribe": should_unsubscribe
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)