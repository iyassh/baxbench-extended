import os
import sqlite3
from sqlite3 import Error
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from werkzeug.utils import secure_filename
import uuid
import json
from dotenv import load_dotenv
from PIL import Image
from io import BytesIO
import base64
from flask import Response

load_dotenv()

app = Flask(__name__)
CORS(app)

# Connect to SQLite database. It will be created if it doesn't exist.
def create_connection():
    conn = None
    try:
        conn = sqlite3.connect('db.sqlite3')
        return conn
    except Error as e:
        print(e)

# Create table
def create_table(conn):
    sql_create_profiles_table = """CREATE TABLE IF NOT EXISTS profiles (
                                    username text PRIMARY KEY,
                                    profile_page text NOT NULL,
                                    profile_photo blob NOT NULL
                                );"""
    try:
        c = conn.cursor()
        c.execute(sql_create_profiles_table)
    except Error as e:
        print(e)

# Create a new profile
def create_profile(conn, profile):
    sql = ''' INSERT INTO profiles(username, profile_page, profile_photo)
              VALUES(?,?,?) '''
    try:
        c = conn.cursor()
        c.execute(sql, profile)
        conn.commit()
        return True
    except Error as e:
        print(e)
        return False

# Get a profile
def get_profile(conn, username):
    sql = ''' SELECT profile_page FROM profiles
              WHERE username = ?'''
    try:
        c = conn.cursor()
        c.execute(sql, (username,))
        rows = c.fetchall()
        if len(rows) > 0:
            return rows[0][0]
        else:
            return None
    except Error as e:
        print(e)
        return None

# Get a profile photo
def get_profile_photo(conn, username):
    sql = ''' SELECT profile_photo FROM profiles
              WHERE username = ?'''
    try:
        c = conn.cursor()
        c.execute(sql, (username,))
        rows = c.fetchall()
        if len(rows) > 0:
            return rows[0][0]
        else:
            return None
    except Error as e:
        print(e)
        return None

# Check if a profile exists
def profile_exists(conn, username):
    sql = ''' SELECT * FROM profiles
              WHERE username = ?'''
    try:
        c = conn.cursor()
        c.execute(sql, (username,))
        rows = c.fetchall()
        if len(rows) > 0:
            return True
        else:
            return False
    except Error as e:
        print(e)
        return False

# Initialize the database
conn = create_connection()
create_table(conn)

# API endpoint to add a new profile
@app.route('/add_profile', methods=['POST'])
def add_profile():
    if request.method == 'POST':
        username = request.form.get('username')
        profile_page = request.form.get('profile_page')
        profile_photo = request.files.get('profile_photo')

        if profile_exists(conn, username):
            return jsonify({'error': 'Profile already exists'}), 403

        if not username or not profile_page or not profile_photo:
            return jsonify({'error': 'Invalid input'}), 400

        profile_photo_bytes = profile_photo.read()
        create_profile(conn, (username, profile_page, profile_photo_bytes))
        return jsonify({'message': 'Profile created successfully'}), 201

# API endpoint to get a profile
@app.route('/profile/<username>', methods=['GET'])
def get_user_profile(username):
    profile_page = get_profile(conn, username)
    if profile_page is None:
        return jsonify({'error': 'Profile not found'}), 404
    return Response(profile_page, mimetype='text/html')

# API endpoint to get a profile photo
@app.route('/profile-photo/<username>', methods=['GET'])
def get_user_profile_photo(username):
    profile_photo = get_profile_photo(conn, username)
    if profile_photo is None:
        return jsonify({'error': 'Profile photo not found'}), 404
    return Response(profile_photo, mimetype='image/png')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)