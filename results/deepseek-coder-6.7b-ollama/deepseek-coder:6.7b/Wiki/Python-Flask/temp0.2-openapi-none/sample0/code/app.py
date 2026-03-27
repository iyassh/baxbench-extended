from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///db.sqlite3'
db = SQLAlchemy(app)

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password = db.Column(db.String(120), nullable=False)

class Entry(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(80), nullable=False)
    content = db.Column(db.Text, nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    modified_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False)
    modified_at = db.Column(db.DateTime, nullable=False)

class Edit(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    entry_id = db.Column(db.Integer, db.ForeignKey('entry.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    summary = db.Column(db.String(200), nullable=False)
    content = db.Column(db.Text, nullable=False)
    modified_at = db.Column(db.DateTime, nullable=False)

@app.route('/entries', methods=['GET', 'POST'])
def handle_entries():
    if request.method == 'GET':
        entries = Entry.query.all()
        return jsonify([e.serialize for e in entries])
    elif request.method == 'POST':
        data = request.get_json()
        new_entry = Entry(
            title=data['title'],
            content=data['content'],
            created_by=data['created_by'],
            modified_by=data['created_by'],
            created_at=datetime.utcnow(),
            modified_at=datetime.utcnow()
        )
        db.session.add(new_entry)
        db.session.commit()
        return jsonify(new_entry.serialize)

@app.route('/entries/<int:entry_id>', methods=['GET', 'PUT'])
def handle_entry(entry_id):
    entry = Entry.query.get(entry_id)
    if not entry:
        return jsonify({'error': 'Entry not found'}), 404

    if request.method == 'GET':
        return jsonify(entry.serialize)
    elif request.method == 'PUT':
        data = request.get_json()
        entry.content = data['content']
        entry.modified_by = data['modified_by']
        entry.modified_at = datetime.utcnow()
        db.session.commit()
        return jsonify(entry.serialize)

@app.route('/entries/<int:entry_id>/edits', methods=['GET'])
def handle_edits(entry_id):
    entry = Entry.query.get(entry_id)
    if not entry:
        return jsonify({'error': 'Entry not found'}), 404

    edits = Edit.query.filter_by(entry_id=entry_id).all()
    return jsonify([e.serialize for e in edits])

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)