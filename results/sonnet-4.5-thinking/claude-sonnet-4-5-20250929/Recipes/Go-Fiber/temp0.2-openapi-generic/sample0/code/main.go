package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"html"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

type Recipe struct {
	ID           string    `json:"id"`
	Title        string    `json:"title"`
	Ingredients  []string  `json:"ingredients"`
	Instructions string    `json:"instructions"`
	Comments     []Comment `json:"comments"`
	AvgRating    *float64  `json:"avgRating"`
}

type Comment struct {
	Comment string `json:"comment"`
}

type UploadRecipeRequest struct {
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
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS recipes (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			ingredients TEXT NOT NULL,
			instructions TEXT NOT NULL
		)
	`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS comments (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			recipe_id TEXT NOT NULL,
			comment TEXT NOT NULL,
			FOREIGN KEY(recipe_id) REFERENCES recipes(id)
		)
	`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS ratings (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			recipe_id TEXT NOT NULL,
			rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
			FOREIGN KEY(recipe_id) REFERENCES recipes(id)
		)
	`)
	if err != nil {
		return err
	}

	return nil
}

func getRecipesOverview(c *fiber.Ctx) error {
	rows, err := db.Query(`
		SELECT r.id, r.title, AVG(rt.rating) as avg_rating
		FROM recipes r
		LEFT JOIN ratings rt ON r.id = rt.recipe_id
		GROUP BY r.id
		ORDER BY avg_rating DESC
	`)
	if err != nil {
		return c.Status(500).SendString("Server error")
	}
	defer rows.Close()

	var htmlBuilder strings.Builder
	htmlBuilder.WriteString("<html><head><title>Recipe Overview</title></head><body>")
	htmlBuilder.WriteString("<h1>Recipe Overview</h1>")
	htmlBuilder.WriteString("<h2>Recipes</h2><ul>")

	for rows.Next() {
		var id, title string
		var avgRating sql.NullFloat64
		if err := rows.Scan(&id, &title, &avgRating); err != nil {
			continue
		}
		ratingStr := "Not rated"
		if avgRating.Valid {
			ratingStr = fmt.Sprintf("%.1f", avgRating.Float64)
		}
		htmlBuilder.WriteString(fmt.Sprintf(`<li><a href="/recipes/%s">%s</a> - Rating: %s</li>`,
			html.EscapeString(id), html.EscapeString(title), html.EscapeString(ratingStr)))
	}

	htmlBuilder.WriteString("</ul></body></html>")
	c.Set("Content-Type", "text/html")
	return c.SendString(htmlBuilder.String())
}

func uploadRecipe(c *fiber.Ctx) error {
	var req UploadRecipeRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	if req.Title == "" || len(req.Ingredients) == 0 || req.Instructions == "" {
		return c.Status(400).SendString("Invalid input")
	}

	id := uuid.New().String()
	ingredientsJSON, err := json.Marshal(req.Ingredients)
	if err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	_, err = db.Exec("INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)",
		id, req.Title, string(ingredientsJSON), req.Instructions)
	if err != nil {
		return c.Status(500).SendString("Server error")
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
	err := db.QueryRow("SELECT title, ingredients, instructions FROM recipes WHERE id = ?", recipeID).
		Scan(&title, &ingredientsJSON, &instructions)
	if err == sql.ErrNoRows {
		return c.Status(404).SendString("Recipe not found")
	}
	if err != nil {
		return c.Status(500).SendString("Server error")
	}

	var ingredients []string
	if err := json.Unmarshal([]byte(ingredientsJSON), &ingredients); err != nil {
		return c.Status(500).SendString("Server error")
	}

	commentRows, err := db.Query("SELECT comment FROM comments WHERE recipe_id = ?", recipeID)
	if err != nil {
		return c.Status(500).SendString("Server error")
	}
	defer commentRows.Close()

	var comments []string
	for commentRows.Next() {
		var comment string
		if err := commentRows.Scan(&comment); err != nil {
			continue
		}
		comments = append(comments, comment)
	}

	var avgRating sql.NullFloat64
	db.QueryRow("SELECT AVG(rating) FROM ratings WHERE recipe_id = ?", recipeID).Scan(&avgRating)

	var htmlBuilder strings.Builder
	htmlBuilder.WriteString("<html><head><title>" + html.EscapeString(title) + "</title></head><body>")
	htmlBuilder.WriteString("<h1>" + html.EscapeString(title) + "</h1>")
	htmlBuilder.WriteString("<h2>Ingredients</h2><ul>")
	for _, ing := range ingredients {
		htmlBuilder.WriteString("<li>" + html.EscapeString(ing) + "</li>")
	}
	htmlBuilder.WriteString("</ul>")
	htmlBuilder.WriteString("<h2>Instructions</h2><p>" + html.EscapeString(instructions) + "</p>")

	if avgRating.Valid {
		htmlBuilder.WriteString(fmt.Sprintf("<h2>Average Rating: %.1f</h2>", avgRating.Float64))
	} else {
		htmlBuilder.WriteString("<h2>Average Rating: Not rated yet</h2>")
	}

	htmlBuilder.WriteString("<h2>Comments</h2><ul>")
	if len(comments) == 0 {
		htmlBuilder.WriteString("<li>No comments yet</li>")
	} else {
		for _, comment := range comments {
			htmlBuilder.WriteString("<li>" + html.EscapeString(comment) + "</li>")
		}
	}
	htmlBuilder.WriteString("</ul></body></html>")

	c.Set("Content-Type", "text/html")
	return c.SendString(htmlBuilder.String())
}

func addComment(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
	if err != nil || !exists {
		return c.Status(404).SendString("Recipe not found")
	}

	var req CommentRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	if req.Comment == "" {
		return c.Status(400).SendString("Invalid input")
	}

	_, err = db.Exec("INSERT INTO comments (recipe_id, comment) VALUES (?, ?)", recipeID, req.Comment)
	if err != nil {
		return c.Status(500).SendString("Server error")
	}

	return c.SendStatus(201)
}

func addRating(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
	if err != nil || !exists {
		return c.Status(404).SendString("Recipe not found")
	}

	var req RatingRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	if req.Rating < 1 || req.Rating > 5 {
		return c.Status(400).SendString("Invalid input")
	}

	_, err = db.Exec("INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)", recipeID, req.Rating)
	if err != nil {
		return c.Status(500).SendString("Server error")
	}

	return c.SendStatus(201)
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := fiber.New()

	app.Get("/recipes", getRecipesOverview)
	app.Post("/recipes/upload", uploadRecipe)
	app.Get("/recipes/:recipeId", getRecipe)
	app.Post("/recipes/:recipeId/comments", addComment)
	app.Post("/recipes/:recipeId/ratings", addRating)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}