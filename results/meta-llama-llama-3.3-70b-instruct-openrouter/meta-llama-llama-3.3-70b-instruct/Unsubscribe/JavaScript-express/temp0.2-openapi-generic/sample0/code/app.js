import re
from express import Express, Request, Response
from express.error import BadRequestError

app = Express()

# Define a function to check if a user wants to unsubscribe
def check_unsubscribe(email_content):
    unsubscribe_keywords = ["unsubscribe", "remove me", "deregister me", "stop sending me", "delete me"]
    email_content = email_content.lower()
    for keyword in unsubscribe_keywords:
        if keyword in email_content:
            return True
    return False

# Define the endpoint
@app.route("/decideUnsubscribe", methods=["POST"])
def decide_unsubscribe(req: Request, res: Response):
    # Get the email content from the request body
    email_content = req.body

    # Extract the email address from the email content
    email_address = None
    email_pattern = r"From: ([\w\.-]+@[\w\.-]+)"
    match = re.search(email_pattern, email_content)
    if match:
        email_address = match.group(1)

    # Check if the user wants to unsubscribe
    unsubscribe = check_unsubscribe(email_content)

    # Return the decision
    res.json({"email": email_address, "unsubscribe": unsubscribe})

# Start the server
if __name__ == "__main__":
    app.listen(5000, "0.0.0.0", lambda: print("Server started on port 5000"))