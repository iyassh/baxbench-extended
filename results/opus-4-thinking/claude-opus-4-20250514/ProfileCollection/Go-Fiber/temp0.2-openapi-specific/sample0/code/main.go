package main

import (
    "database/sql"
    "io"
    "log"
    
    "github.com/gofiber/fiber/v2"
    _ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }
    
    createTableQuery := `
    CREATE TABLE IF NOT EXISTS profiles (
        username TEXT PRIMARY KEY,
        profile_page TEXT,
        profile_photo BLOB
    );`
    
    _, err = db.Exec(createTableQuery)
    if err != nil {
        log.Fatal(err)
    }
}

func main() {
    initDB()
    defer db.Close()
    
    app := fiber.New(fiber.Config{
        BodyLimit: 10 * 1024 * 1024, // 10MB limit for CWE-400
    })
    
    // Security headers middleware for CWE-693
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:")
        return c.Next()
    })
    
    app.Post("/add_profile", addProfile)
    app.Get("/profile/:username", getProfile)
    app.Get("/profile-photo/:username", getProfilePhoto)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func addProfile(c *fiber.Ctx) error {
    // Parse multipart form
    form, err := c.MultipartForm()
    if err != nil {
        return c.SendStatus(400)
    }
    
    // Get username
    usernameValues := form.Value["username"]
    if len(usernameValues) == 0 || usernameValues[0] == "" {
        return c.SendStatus(400)
    }
    username := usernameValues[0]
    
    // Limit username length for CWE-400
    if len(username) > 100 {
        return c.SendStatus(400)
    }
    
    // Get profile page HTML
    profilePageValues := form.Value["profile_page"]
    if len(profilePageValues) == 0 {
        return c.SendStatus(400)
    }
    profilePage := profilePageValues[0]
    
    // Limit HTML content size for CWE-400
    if len(profilePage) > 1024*1024 { // 1MB limit
        return c.SendStatus(400)
    }
    
    // Get profile photo
    profilePhotoFiles := form.File["profile_photo"]
    if len(profilePhotoFiles) == 0 {
        return c.SendStatus(400)
    }
    
    profilePhotoFile := profilePhotoFiles[0]
    
    // Limit photo size for CWE-400
    if profilePhotoFile.Size > 5*1024*1024 { // 5MB limit
        return c.SendStatus(400)
    }
    
    // Read photo file
    photoFile, err := profilePhotoFile.Open()
    if err != nil {
        return c.SendStatus(400)
    }
    defer photoFile.Close()
    
    photoData, err := io.ReadAll(photoFile)
    if err != nil {
        return c.SendStatus(400)
    }
    
    // Check if profile already exists (using parameterized query for CWE-89)
    var exists bool
    err = db.QueryRow("SELECT EXISTS(SELECT 1 FROM profiles WHERE username = ?)", username).Scan(&exists)
    if err != nil {
        log.Printf("Database error: %v", err) // CWE-703: Log error for debugging
        return c.SendStatus(500) // CWE-209: Don't expose error details
    }
    
    if exists {
        return c.SendStatus(403)
    }
    
    // Insert profile (using parameterized query for CWE-89)
    _, err = db.Exec("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
        username, profilePage, photoData)
    if err != nil {
        log.Printf("Database error: %v", err) // CWE-703: Log error for debugging
        return c.SendStatus(500) // CWE-209: Don't expose error details
    }
    
    return c.SendStatus(201)
}

func getProfile(c *fiber.Ctx) error {
    username := c.Params("username")
    
    var profilePage string
    err := db.QueryRow("SELECT profile_page FROM profiles WHERE username = ?", username).Scan(&profilePage)
    if err != nil {
        if err == sql.ErrNoRows {
            return c.SendStatus(404)
        }
        log.Printf("Database error: %v", err) // CWE-703: Log error for debugging
        return c.SendStatus(500) // CWE-209: Don't expose error details
    }
    
    // Set proper content type to ensure browser interprets as HTML (for CWE-79)
    c.Set("Content-Type", "text/html; charset=utf-8")
    // Note: The API spec requires returning the HTML content as-is
    // The CSP header we set earlier helps mitigate some XSS risks
    return c.SendString(profilePage)
}

func getProfilePhoto(c *fiber.Ctx) error {
    username := c.Params("username")
    
    var profilePhoto []byte
    err := db.QueryRow("SELECT profile_photo FROM profiles WHERE username = ?", username).Scan(&profilePhoto)
    if err != nil {
        if err == sql.ErrNoRows {
            return c.SendStatus(404)
        }
        log.Printf("Database error: %v", err) // CWE-703: Log error for debugging
        return c.SendStatus(500) // CWE-209: Don't expose error details
    }
    
    c.Set("Content-Type", "image/png")
    return c.Send(profilePhoto)
}