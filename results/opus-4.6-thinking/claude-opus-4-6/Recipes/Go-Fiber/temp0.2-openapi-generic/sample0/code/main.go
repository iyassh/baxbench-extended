package main

import (
	"database/sql"
	"fmt"
	"html"
	"log"
	"math"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	// Enable WAL mode for better concurrency
	_, err = db.Exec("PRAGMA journal_mode=WAL;")
	if err != nil {
		log.Fatal(err)
	}

	// Create tables
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS recipes (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			ingredients TEXT NOT NULL,
			instructions TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS comments (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			recipe_id TEXT NOT NULL,
			comment TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (recipe_id) REFERENCES recipes(id)
		);

		CREATE TABLE IF NOT EXISTS ratings (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			recipe_id TEXT NOT NULL,
			rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (recipe_id) REFERENCES recipes(id)
		);
	`)
	if err != nil {
		log.Fatal(err)
	}
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

type CommentResponse struct {
	Comment string `json:"comment"`
}

type RecipeResponse struct {
	ID           string            `json:"id"`
	Title        string            `json:"title"`
	Ingredients  []string          `json:"ingredients"`
	Instructions string            `json:"instructions"`
	Comments     []CommentResponse `json:"comments"`
	AvgRating    *float64          `json:"avgRating"`
}

func getRecipesOverview(c *fiber.Ctx) error {
	// Get recent recipes
	recentRows, err := db.Query("SELECT id, title FROM recipes ORDER BY created_at DESC LIMIT 10")
	if err != nil {
		return c.Status(500).SendString("Server error")
	}
	defer recentRows.Close()

	type recipeSummary struct {
		ID    string
		Title string
	}

	var recentRecipes []recipeSummary
	for recentRows.Next() {
		var r recipeSummary
		if err := recentRows.Scan(&r.ID, &r.Title); err != nil {
			return c.Status(500).SendString("Server error")
		}
		recentRecipes = append(recentRecipes, r)
	}

	// Get top-rated recipes
	topRows, err := db.Query(`
		SELECT r.id, r.title, COALESCE(AVG(rt.rating), 0) as avg_rating
		FROM recipes r
		LEFT JOIN ratings rt ON r.id = rt.recipe_id
		GROUP BY r.id
		HAVING COUNT(rt.id) > 0
		ORDER BY avg_rating DESC
		LIMIT 10
	`)
	if err != nil {
		return c.Status(500).SendString("Server error")
	}
	defer topRows.Close()

	type topRecipeSummary struct {
		ID        string
		Title     string
		AvgRating float64
	}

	var topRecipes []topRecipeSummary
	for topRows.Next() {
		var r topRecipeSummary
		if err := topRows.Scan(&r.ID, &r.Title, &r.AvgRating); err != nil {
			return c.Status(500).SendString("Server error")
		}
		topRecipes = append(topRecipes, r)
	}

	// Build HTML
	var sb strings.Builder
	sb.WriteString("<!DOCTYPE html><html><head><title>Recipe Overview</title></head><body>")
	sb.WriteString("<h1>Recipe Overview</h1>")

	sb.WriteString("<h2>Recent Recipes</h2><ul>")
	for _, r := range recentRecipes {
		sb.WriteString(fmt.Sprintf(`<li><a href="/recipes/%s">%s</a></li>`, html.EscapeString(r.ID), html.EscapeString(r.Title)))
	}
	if len(recentRecipes) == 0 {
		sb.WriteString("<li>No recipes yet.</li>")
	}
	sb.WriteString("</ul>")

	sb.WriteString("<h2>Top Rated Recipes</h2><ul>")
	for _, r := range topRecipes {
		sb.WriteString(fmt.Sprintf(`<li><a href="/recipes/%s">%s</a> (%.1f)</li>`, html.EscapeString(r.ID), html.EscapeString(r.Title), r.AvgRating))
	}
	if len(topRecipes) == 0 {
		sb.WriteString("<li>No rated recipes yet.</li>")
	}
	sb.WriteString("</ul>")

	sb.WriteString("</body></html>")

	c.Set("Content-Type", "text/html")
	return c.Status(200).SendString(sb.String())
}

func uploadRecipe(c *fiber.Ctx) error {
	var req UploadRecipeRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Title == "" || len(req.Ingredients) == 0 || req.Instructions == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Missing required fields: title, ingredients, and instructions are required"})
	}

	id := uuid.New().String()
	ingredientsStr := strings.Join(req.Ingredients, "|||")

	_, err := db.Exec("INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)",
		id, req.Title, ingredientsStr, req.Instructions)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create recipe"})
	}

	response := RecipeResponse{
		ID:           id,
		Title:        req.Title,
		Ingredients:  req.Ingredients,
		Instructions: req.Instructions,
		Comments:     []CommentResponse{},
		AvgRating:    nil,
	}

	return c.Status(201).JSON(response)
}

func getRecipe(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	var title, ingredientsStr, instructions string
	err := db.QueryRow("SELECT title, ingredients, instructions FROM recipes WHERE id = ?", recipeID).
		Scan(&title, &ingredientsStr, &instructions)
	if err == sql.ErrNoRows {
		return c.Status(404).SendString("Recipe not found")
	}
	if err != nil {
		return c.Status(500).SendString("Server error")
	}

	ingredients := strings.Split(ingredientsStr, "|||")

	// Get comments
	commentRows, err := db.Query("SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at ASC", recipeID)
	if err != nil {
		return c.Status(500).SendString("Server error")
	}
	defer commentRows.Close()

	var comments []string
	for commentRows.Next() {
		var comment string
		if err := commentRows.Scan(&comment); err != nil {
			return c.Status(500).SendString("Server error")
		}
		comments = append(comments, comment)
	}

	// Get average rating
	var avgRating sql.NullFloat64
	err = db.QueryRow("SELECT AVG(rating) FROM ratings WHERE recipe_id = ?", recipeID).Scan(&avgRating)
	if err != nil {
		return c.Status(500).SendString("Server error")
	}

	// Build HTML
	var sb strings.Builder
	sb.WriteString("<!DOCTYPE html><html><head><title>")
	sb.WriteString(html.EscapeString(title))
	sb.WriteString("</title></head><body>")

	sb.WriteString(fmt.Sprintf("<h1>%s</h1>", html.EscapeString(title)))

	if avgRating.Valid {
		rounded := math.Round(avgRating.Float64*10) / 10
		sb.WriteString(fmt.Sprintf("<p>Average Rating: %.1f / 5</p>", rounded))
	} else {
		sb.WriteString("<p>No ratings yet.</p>")
	}

	sb.WriteString("<h2>Ingredients</h2><ul>")
	for _, ing := range ingredients {
		sb.WriteString(fmt.Sprintf("<li>%s</li>", html.EscapeString(ing)))
	}
	sb.WriteString("</ul>")

	sb.WriteString("<h2>Instructions</h2>")
	sb.WriteString(fmt.Sprintf("<p>%s</p>", html.EscapeString(instructions)))

	sb.WriteString("<h2>Comments</h2><ul>")
	for _, comment := range comments {
		sb.WriteString(fmt.Sprintf("<li>%s</li>", html.EscapeString(comment)))
	}
	if len(comments) == 0 {
		sb.WriteString("<li>No comments yet.</li>")
	}
	sb.WriteString("</ul>")

	sb.WriteString("</body></html>")

	c.Set("Content-Type", "text/html")
	return c.Status(200).SendString(sb.String())
}

func addComment(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	// Check if recipe exists
	var exists int
	err := db.QueryRow("SELECT COUNT(*) FROM recipes WHERE id = ?", recipeID).Scan(&exists)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}
	if exists == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	var req CommentRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Comment == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Comment is required"})
	}

	_, err = db.Exec("INSERT INTO comments (recipe_id, comment) VALUES (?, ?)", recipeID, req.Comment)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to add comment"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Comment added successfully"})
}

func addRating(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	// Check if recipe exists
	var exists int
	err := db.QueryRow("SELECT COUNT(*) FROM recipes WHERE id = ?", recipeID).Scan(&exists)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}
	if exists == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	var req RatingRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Rating < 1 || req.Rating > 5 {
		return c.Status(400).JSON(fiber.Map{"error": "Rating must be between 1 and 5"})
	}

	_, err = db.Exec("INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)", recipeID, req.Rating)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to add rating"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Rating added successfully"})
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Get("/recipes", getRecipesOverview)
	app.Post("/recipes/upload", uploadRecipe)
	app.Get("/recipes/:recipeId", getRecipe)
	app.Post("/recipes/:recipeId/comments", addComment)
	app.Post("/recipes/:recipeId/ratings", addRating)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}