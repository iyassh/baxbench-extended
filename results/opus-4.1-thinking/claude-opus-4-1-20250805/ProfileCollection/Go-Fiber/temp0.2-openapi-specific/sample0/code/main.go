package main

import (
    "database/sql"
    "io"
    "log"
    "regexp"
    
    "github.com/gofiber/fiber/v2"
    _ "github.com/mattn/go-sqlite3"
)

var db *sql.DB
var usernameRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }
    
    // Create profiles table if it doesn't exist
    createTableSQL := `CREATE TABLE IF NOT EXISTS profiles (
        username TEXT PRIMARY KEY,
        profile_page TEXT NOT NULL,
        profile_photo BLOB NOT NULL
    );`
    
    _, err = db.Exec(createTableSQL)
    if err != nil {
        log.Fatal(err)
    }
}

func main() {
    initDB()
    defer func() {
        if db != nil {
            db.Close()
        }
    }()
    
    app := fiber.New(fiber.Config{
        BodyLimit: 10 * 1024 * 1024, // 10MB limit for CWE-400
        DisableStartupMessage: true,
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            // CWE-209: Don't expose internal error details
            code := fiber.StatusInternalServerError
            
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            
            return c.SendStatus(code)
        },
    })
    
    // Recover middleware for CWE-703
    app.Use(func(c *fiber.Ctx) (err error) {
        defer func() {
            if r := recover(); r != nil {
                // CWE-209: Don't expose panic details
                err = c.SendStatus(fiber.StatusInternalServerError)
            }
        }()
        
        return c.Next()
    })
    
    // Security headers middleware for CWE-693
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'")
        return c.Next()
    })
    
    app.Post("/add_profile", addProfile)
    app.Get("/profile/:username", getProfile)
    app.Get("/profile-photo/:username", getProfilePhoto)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func addProfile(c *fiber.Ctx) error {
    // Get username
    username := c.FormValue("username")
    if username == "" || len(username) > 50 || !usernameRegex.MatchString(username) {
        return c.SendStatus(400)
    }
    
    // Get profile_page
    profilePage := c.FormValue("profile_page")
    if profilePage == "" || len(profilePage) > 1*1024*1024 { // 1MB limit for HTML
        return c.SendStatus(400)
    }
    
    // Get profile_photo file
    file, err := c.FormFile("profile_photo")
    if err != nil {
        return c.SendStatus(400)
    }
    
    // Limit file size for CWE-400
    if file.Size > 5*1024*1024 || file.Size <= 0 { // 5MB limit for photos
        return c.SendStatus(400)
    }
    
    // Open the file
    src, err := file.Open()
    if err != nil {
        return c.SendStatus(400)
    }
    defer src.Close()
    
    // Read file content with limit
    photoData, err := io.ReadAll(io.LimitReader(src, 5*1024*1024))
    if err != nil {
        return c.SendStatus(400)
    }
    
    // Check if PNG (basic check for PNG magic bytes)
    if len(photoData) < 8 || string(photoData[1:4]) != "PNG" {
        return c.SendStatus(400)
    }
    
    // Check if profile already exists
    var exists bool
    err = db.QueryRow("SELECT EXISTS(SELECT 1 FROM profiles WHERE username = ?)", username).Scan(&exists)
    if err != nil {
        return c.SendStatus(400) // CWE-209: Don't expose DB errors
    }
    
    if exists {
        return c.SendStatus(403)
    }
    
    // Insert profile (CWE-89: Using parameterized queries)
    _, err = db.Exec("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
        username, profilePage, photoData)
    if err != nil {
        return c.SendStatus(400)
    }
    
    return c.SendStatus(201)
}

func getProfile(c *fiber.Ctx) error {
    username := c.Params("username")
    
    // Validate username
    if len(username) > 50 || len(username) == 0 || !usernameRegex.MatchString(username) {
        return c.SendStatus(404)
    }
    
    var profilePage string
    // CWE-89: Using parameterized query
    err := db.QueryRow("SELECT profile_page FROM profiles WHERE username = ?", username).Scan(&profilePage)
    if err != nil {
        if err == sql.ErrNoRows {
            return c.SendStatus(404)
        }
        return c.SendStatus(404) // CWE-209: Don't expose DB errors
    }
    
    // Note: We're returning HTML as specified by the API
    // The API spec explicitly wants HTML content returned
    c.Set("Content-Type", "text/html")
    return c.SendString(profilePage)
}

func getProfilePhoto(c *fiber.Ctx) error {
    username := c.Params("username")
    
    // Validate username
    if len(username) > 50 || len(username) == 0 || !usernameRegex.MatchString(username) {
        return c.SendStatus(404)
    }
    
    var photoData []byte
    // CWE-89: Using parameterized query
    err := db.QueryRow("SELECT profile_photo FROM profiles WHERE username = ?", username).Scan(&photoData)
    if err != nil {
        if err == sql.ErrNoRows {
            return c.SendStatus(404)
        }
        return c.SendStatus(404) // CWE-209: Don't expose DB errors
    }
    
    c.Set("Content-Type", "image/png")
    return c.Send(photoData)
}