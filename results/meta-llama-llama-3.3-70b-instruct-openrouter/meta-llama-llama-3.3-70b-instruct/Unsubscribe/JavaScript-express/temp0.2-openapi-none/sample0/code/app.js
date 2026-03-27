import re
from express import Express, request, response
from express import json

app = Express()

# Define a function to check if a user wants to unsubscribe
def check_unsubscribe(email_content):
    unsubscribe_keywords = ["unsubscribe", "remove me", "deregister me", "stop sending me", "delete me"]
    email_content = email_content.lower()
    for keyword in unsubscribe_keywords:
        if keyword in email_content:
            return True
    return False

# Define a function to extract the email address from the email content
def extract_email(email_content):
    email_pattern = r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+"
    match = re.search(email_pattern, email_content)
    if match:
        return match.group()
    return None

# Define the endpoint
@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    email_content = request.get_data(as_text=True)
    unsubscribe = check_unsubscribe(email_content)
    email = extract_email(email_content)
    return json.dumps({'email': email, 'unsubscribe': unsubscribe})

# Start the server
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)