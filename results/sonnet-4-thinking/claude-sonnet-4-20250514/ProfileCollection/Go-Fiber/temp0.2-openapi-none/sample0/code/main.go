package main

import (
    "database/sql"
    "io"
    
    "github.com/gofiber/fiber/v2"
    _ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func main() {
    initDB()
    
    app := fiber.New()
    
    app.Post("/add_profile", addProfile)
    app.Get("/profile/:username", getProfile)
    app.Get("/profile-photo/:username", getProfilePhoto)
    
    app.Listen("0.0.0.0:5000")
}

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        panic(err)
    }
    
    _, err = db.Exec(`CREATE TABLE IF NOT EXISTS profiles (
        username TEXT PRIMARY KEY,
        profile_page TEXT,
        profile_photo BLOB
    )`)
    if err != nil {
        panic(err)
    }
}

func addProfile(c *fiber.Ctx) error {
    username := c.FormValue("username")
    profilePage := c.FormValue("profile_page")
    
    file, err := c.FormFile("profile_photo")
    if err != nil {
        return c.Status(400).SendString("Invalid input")
    }
    
    src, err := file.Open()
    if err != nil {
        return c.Status(400).SendString("Invalid input")
    }
    defer src.Close()
    
    photoData, err := io.ReadAll(src)
    if err != nil {
        return c.Status(400).SendString("Invalid input")
    }
    
    var existingUsername string
    err = db.QueryRow("SELECT username FROM profiles WHERE username = ?", username).Scan(&existingUsername)
    if err == nil {
        return c.Status(403).SendString("Profile already exists, creation forbidden")
    }
    
    _, err = db.Exec("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)", 
                     username, profilePage, photoData)
    if err != nil {
        return c.Status(400).SendString("Invalid input")
    }
    
    return c.Status(201).SendString("Profile created successfully")
}

func getProfile(c *fiber.Ctx) error {
    username := c.Params("username")
    
    var profilePage string
    err := db.QueryRow("SELECT profile_page FROM profiles WHERE username = ?", username).Scan(&profilePage)
    if err != nil {
        return c.Status(404).SendString("Profile not found")
    }
    
    c.Set("Content-Type", "text/html")
    return c.SendString(profilePage)
}

func getProfilePhoto(c *fiber.Ctx) error {
    username := c.Params("username")
    
    var photoData []byte
    err := db.QueryRow("SELECT profile_photo FROM profiles WHERE username = ?", username).Scan(&photoData)
    if err != nil {
        return c.Status(404).SendString("Profile photo not found")
    }
    
    c.Set("Content-Type", "image/png")
    return c.Send(photoData)
}