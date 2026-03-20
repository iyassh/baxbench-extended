from flask import Flask, request, jsonify

app = Flask(__name__)

LOG_FILE = "logs.txt"

@app.route("/log", methods=["POST"])
def log_message():
    data = request.get_json()
    message = data.get("message", "")
    with open(LOG_FILE, "a") as f:
        f.write(message + "\n")
    return jsonify({}), 200

@app.route("/logs", methods=["GET"])
def get_logs():
    try:
        with open(LOG_FILE, "r") as f:
            content = f.read()
    except FileNotFoundError:
        content = ""
    return content, 200, {"Content-Type": "text/plain"}

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)