from flask import Flask, request, jsonify
import re
import logging

app = Flask(__name__)

# Configure logging to avoid exposing sensitive information
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    response.headers['X-Permitted-Cross-Domain-Policies'] = 'none'
    return response

def extract_email_from_raw(raw_email):
    """Extract sender's email address from raw email content."""
    try:
        # Look for From: header with email in angle brackets
        from_match = re.search(r'From:\s*[^<]*<([^>]+@[^>]+)>', raw_email, re.IGNORECASE)
        if not from_match:
            # Try without angle brackets
            from_match = re.search(r'From:\s*([^\s<]+@[^\s>]+)', raw_email, re.IGNORECASE)
        
        if from_match:
            return from_match.group(1).strip()
        
        return None
    except Exception:
        # Don't expose internal errors
        logger.exception("Error extracting email")
        return None

def extract_email_body(raw_email):
    """Extract the text content from the email body."""
    try:
        # First try to extract text/plain part
        text_plain_pattern = r'Content-Type:\s*text/plain[^\n]*\n(?:Content-Transfer-Encoding:[^\n]*\n)?(?:\n)?(.*?)(?=\n--\w+|$)'
        text_plain_match = re.search(text_plain_pattern, raw_email, re.DOTALL | re.IGNORECASE)
        
        if text_plain_match:
            text_content = text_plain_match.group(1).strip()
            
            # Handle quoted-printable encoding if present
            if 'Content-Transfer-Encoding:quoted-printable' in raw_email or 'Content-Transfer-Encoding: quoted-printable' in raw_email:
                # Remove soft line breaks
                text_content = re.sub(r'=\r?\n', '', text_content)
                # Decode hex values
                def decode_quoted_printable(match):
                    try:
                        return chr(int(match.group(1), 16))
                    except:
                        return match.group(0)
                text_content = re.sub(r'=([0-9A-Fa-f]{2})', decode_quoted_printable, text_content)
            
            return text_content
        
        # If no text/plain part found, try to get any content after headers
        headers_end = raw_email.find('\n\n')
        if headers_end != -1:
            return raw_email[headers_end+2:].strip()
        
        return ""
    except Exception:
        # Don't expose internal errors
        logger.exception("Error extracting email body")
        return ""

def check_unsubscribe_request(content):
    """Check if the email content contains unsubscribe-related keywords."""
    try:
        # Convert to lowercase for case-insensitive matching
        content_lower = content.lower()
        
        # Keywords and phrases to look for
        unsubscribe_patterns = [
            r'\bunsubscribe\b',
            r'\bremove\s+me\b',
            r'\bderegister\s+me\b',
            r'\bstop\s+sending\s+me\b',
            r'\bdelete\s+me\b',
            r'\bopt\s*out\b',
            r'\bcancel\s+subscription\b',
            r'\bremove\s+from\s+list\b',
            r'\btake\s+me\s+off\b',
            r'\bremove\s+my\s+email\b',
            r'\bunsubscribe\s+me\b'
        ]
        
        # Check if any pattern matches
        for pattern in unsubscribe_patterns:
            if re.search(pattern, content_lower):
                return True
        
        return False
    except Exception:
        # Don't expose internal errors
        logger.exception("Error checking unsubscribe request")
        return False

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    """Endpoint to decide if a user requested to be unsubscribed from a mailing list."""
    try:
        # Get raw email content
        raw_email = request.get_data(as_text=True)
        
        if not raw_email:
            return jsonify({
                'email': '',
                'unsubscribe': False
            }), 200
        
        # Extract email address
        email_address = extract_email_from_raw(raw_email)
        
        if not email_address:
            # If no email found, return empty string as per schema
            return jsonify({
                'email': '',
                'unsubscribe': False
            }), 200
        
        # Extract email body
        email_body = extract_email_body(raw_email)
        
        # Check for unsubscribe request in body
        should_unsubscribe = check_unsubscribe_request(email_body)
        
        # Also check in subject line
        subject_match = re.search(r'Subject:\s*([^\n]+)', raw_email, re.IGNORECASE)
        if subject_match and not should_unsubscribe:
            should_unsubscribe = check_unsubscribe_request(subject_match.group(1))
        
        # Return response
        return jsonify({
            'email': email_address,
            'unsubscribe': should_unsubscribe
        }), 200
        
    except Exception:
        # Generic error handling without exposing details
        logger.exception("Unexpected error in decide_unsubscribe")
        return jsonify({
            'email': '',
            'unsubscribe': False
        }), 200

# Error handlers to avoid exposing sensitive information
@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Resource not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    logger.exception("Internal server error")
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)