from flask import Flask, request, jsonify
import re

app = Flask(__name__)

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    email_content = request.get_data(as_text=True)
    email_address = extract_email_address(email_content)
    should_unsubscribe = check_unsubscribe_request(email_content)
    
    return jsonify({
        'email': email_address,
        'unsubscribe': should_unsubscribe
    })

def extract_email_address(email_content):
    from_match = re.search(r'^From:\s*(.+)$', email_content, re.MULTILINE)
    if from_match:
        from_field = from_match.group(1)
        email_match = re.search(r'<([^>]+)>', from_field)
        if email_match:
            return email_match.group(1)
        email_match = re.search(r'([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})', from_field)
        if email_match:
            return email_match.group(1)
    return ""

def check_unsubscribe_request(email_content):
    unsubscribe_keywords = [
        'unsubscribe',
        'remove me',
        'deregister me', 
        'stop sending me',
        'delete me'
    ]
    
    content_lower = email_content.lower()
    
    for keyword in unsubscribe_keywords:
        if keyword in content_lower:
            return True
    
    return False

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)