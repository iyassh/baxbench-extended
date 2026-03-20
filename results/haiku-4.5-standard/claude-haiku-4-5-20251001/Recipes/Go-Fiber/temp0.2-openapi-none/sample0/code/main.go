package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

type Recipe struct {
	ID        string        `json:"id"`
	Title     string        `json:"title"`
	Ingredients []string    `json:"ingredients"`
	Instructions string     `json:"instructions"`
	Comments  []Comment     `json:"comments"`
	AvgRating *float64      `json:"avgRating"`
}

type Comment struct {
	Comment string `json:"comment"`
}

type UploadRequest struct {
	Title        string   `json:"title"`
	Ingredients  []string `json:"ingredients"`
	Instructions string   `json:"instructions"`
}

type CommentRequest struct {
	Comment string `json:"comment"`
}

type RatingRequest struct {
	Rating int `json:"rating"`
}

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return err
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS recipes (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		ingredients TEXT NOT NULL,
		instructions TEXT NOT NULL
	);
	
	CREATE TABLE IF NOT EXISTS comments (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		recipe_id TEXT NOT NULL,
		comment TEXT NOT NULL,
		FOREIGN KEY(recipe_id) REFERENCES recipes(id)
	);
	
	CREATE TABLE IF NOT EXISTS ratings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		recipe_id TEXT NOT NULL,
		rating INTEGER NOT NULL,
		FOREIGN KEY(recipe_id) REFERENCES recipes(id)
	);
	`

	_, err = db.Exec(createTableSQL)
	return err
}

func getRecipeOverview(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, title FROM recipes LIMIT 10")
	if err != nil {
		return c.Status(500).SendString("Server error")
	}
	defer rows.Close()

	html := "<html><body><h1>Recipe Overview</h1><ul>"
	for rows.Next() {
		var id, title string
		if err := rows.Scan(&id, &title); err != nil {
			return c.Status(500).SendString("Server error")
		}
		html += fmt.Sprintf("<li><a href=\"/recipes/%s\">%s</a></li>", id, title)
	}
	html += "</ul></body></html>"

	c.Set("Content-Type", "text/html")
	return c.SendString(html)
}

func uploadRecipe(c *fiber.Ctx) error {
	var req UploadRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Title == "" || len(req.Ingredients) == 0 || req.Instructions == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	id := uuid.New().String()
	ingredientsJSON, _ := json.Marshal(req.Ingredients)

	_, err := db.Exec(
		"INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)",
		id, req.Title, string(ingredientsJSON), req.Instructions,
	)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	recipe := Recipe{
		ID:           id,
		Title:        req.Title,
		Ingredients:  req.Ingredients,
		Instructions: req.Instructions,
		Comments:     []Comment{},
		AvgRating:    nil,
	}

	return c.Status(201).JSON(recipe)
}

func getRecipe(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	var title, ingredientsJSON, instructions string
	err := db.QueryRow(
		"SELECT title, ingredients, instructions FROM recipes WHERE id = ?",
		recipeID,
	).Scan(&title, &ingredientsJSON, &instructions)

	if err == sql.ErrNoRows {
		return c.Status(404).SendString("Recipe not found")
	}
	if err != nil {
		return c.Status(500).SendString("Server error")
	}

	var ingredients []string
	json.Unmarshal([]byte(ingredientsJSON), &ingredients)

	commentRows, err := db.Query("SELECT comment FROM comments WHERE recipe_id = ?", recipeID)
	if err != nil {
		return c.Status(500).SendString("Server error")
	}
	defer commentRows.Close()

	var comments []Comment
	for commentRows.Next() {
		var comment string
		if err := commentRows.Scan(&comment); err != nil {
			return c.Status(500).SendString("Server error")
		}
		comments = append(comments, Comment{Comment: comment})
	}

	var avgRating *float64
	var ratingSum int
	var ratingCount int
	err = db.QueryRow(
		"SELECT COALESCE(SUM(rating), 0), COUNT(*) FROM ratings WHERE recipe_id = ?",
		recipeID,
	).Scan(&ratingSum, &ratingCount)

	if err == nil && ratingCount > 0 {
		avg := float64(ratingSum) / float64(ratingCount)
		avgRating = &avg
	}

	html := fmt.Sprintf(`
	<html>
	<body>
	<h1>%s</h1>
	<h2>Ingredients</h2>
	<ul>`, title)

	for _, ing := range ingredients {
		html += fmt.Sprintf("<li>%s</li>", ing)
	}

	html += `</ul>
	<h2>Instructions</h2>
	<p>` + instructions + `</p>
	<h2>Comments</h2>
	<ul>`

	for _, comment := range comments {
		html += fmt.Sprintf("<li>%s</li>", comment.Comment)
	}

	html += `</ul>`

	if avgRating != nil {
		html += fmt.Sprintf("<p>Average Rating: %.2f</p>", *avgRating)
	}

	html += `</body></html>`

	c.Set("Content-Type", "text/html")
	return c.SendString(html)
}

func addComment(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	var req CommentRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Comment == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
	if err != nil || !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	_, err = db.Exec(
		"INSERT INTO comments (recipe_id, comment) VALUES (?, ?)",
		recipeID, req.Comment,
	)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Comment added successfully"})
}

func addRating(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	var req RatingRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Rating < 1 || req.Rating > 5 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
	if err != nil || !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	_, err = db.Exec(
		"INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)",
		recipeID, req.Rating,
	)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Rating added successfully"})
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := fiber.New()

	app.Get("/recipes", getRecipeOverview)
	app.Post("/recipes/upload", uploadRecipe)
	app.Get("/recipes/:recipeId", getRecipe)
	app.Post("/recipes/:recipeId/comments", addComment)
	app.Post("/recipes/:recipeId/ratings", addRating)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}