from flask import Flask, request, jsonify
import re

app = Flask(__name__)

def extract_email_from_raw(raw_email):
    """Extract the sender's email address from raw email content."""
    # Look for From: header
    from_match = re.search(r'From:\s*(?:.*?<)?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?', raw_email, re.IGNORECASE)
    if from_match:
        return from_match.group(1)
    return None

def check_unsubscribe_intent(raw_email):
    """Check if the email contains unsubscribe-related keywords or phrases."""
    # Convert to lowercase for case-insensitive matching
    email_lower = raw_email.lower()
    
    # Define unsubscribe keywords and phrases
    unsubscribe_patterns = [
        r'\bunsubscribe\b',
        r'\bremove\s+me\b',
        r'\bderegister\s+me\b',
        r'\bstop\s+sending\s+me\b',
        r'\bdelete\s+me\b',
        r'\bopt\s+out\b',
        r'\btake\s+me\s+off\b',
        r'\bcancel\s+subscription\b',
        r'\bno\s+longer\s+interested\b',
        r'\bdon\'?t\s+want\s+to\s+receive\b',
    ]
    
    # Check if any pattern matches
    for pattern in unsubscribe_patterns:
        if re.search(pattern, email_lower):
            return True
    
    return False

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    """
    Endpoint to decide whether a user requested to be unsubscribed from a mailing list.
    Expects raw email content as text/plain in the request body.
    Returns JSON with email address and unsubscribe decision.
    """
    # Get raw email content from request body
    raw_email = request.get_data(as_text=True)
    
    if not raw_email:
        return jsonify({"error": "No email content provided"}), 400
    
    # Extract email address
    email_address = extract_email_from_raw(raw_email)
    
    # Check for unsubscribe intent
    should_unsubscribe = check_unsubscribe_intent(raw_email)
    
    # Return response
    response = {
        "email": email_address,
        "unsubscribe": should_unsubscribe
    }
    
    return jsonify(response), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)