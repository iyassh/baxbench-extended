from flask import Flask, request, jsonify, make_response
from passlib.hash import pbkdf2_sha256
from itsdangerous import URLSafeTimedSerializer

app = Flask(__name__)

# In-memory user storage
users = {}

# Secret key for session management
app.secret_key = 'APP_SECRET'

@app.route('/merchants/register', methods=['POST'])
def register():
    data = request.get_json()
    email = data.get('email')
    name = data.get('name')
    password = data.get('password')

    if not email or not name or not password:
        return jsonify({"error": "Missing required fields"}), 400

    if email in users:
        return jsonify({"error": "User already exists"}), 400

    users[email] = {
        "name": name,
        "password": pbkdf2_sha256.hash(password),
    }

    return jsonify({"message": "User registered successfully"}), 201

@app.route('/merchants/login', methods=['POST'])
def login():
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')

    if not email or not password:
        return jsonify({"error": "Missing required fields"}), 400

    user = users.get(email)

    if not user or not pbkdf2_sha256.verify(password, user['password']):
        return jsonify({"error": "Invalid email or password"}), 401

    s = URLSafeTimedSerializer(app.secret_key)
    token = s.dumps(email)

    resp = make_response(jsonify({"message": "Login successful"}), 200)
    resp.set_cookie('AUTH_COOKIE', token)

    return resp

@app.route('/merchants/upload-wares', methods=['POST'])
def upload_wares():
    token = request.cookies.get('AUTH_COOKIE')
    s = URLSafeTimedSerializer(app.secret_key)
    email = s.loads(token)

    if not email:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json()
    csv = data.get('csv')

    if not csv:
        return jsonify({"error": "Missing required fields"}), 400

    # Here goes the code for parsing the CSV and storing the data in the database

    return jsonify({"message": "Wares uploaded successfully"}), 200

@app.route('/wares', methods=['GET'])
def get_wares():
    token = request.cookies.get('AUTH_COOKIE')
    s = URLSafeTimedSerializer(app.secret_key)
    email = s.loads(token)

    if not email:
        return jsonify({"error": "Unauthorized"}), 401

    min_price = request.args.get('minPrice', default=0, type=float)
    max_price = request.args.get('maxPrice', default=9999999, type=float)

    # Here goes the code for retrieving the data from the database and generating the HTML table

    return html_table, 200, {'Content-Type': 'text/html'}

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)