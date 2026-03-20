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
			id TEXT PRIMARY KEY,
			recipe_id TEXT NOT NULL,
			comment TEXT NOT NULL,
			FOREIGN KEY (recipe_id) REFERENCES recipes(id)
		)
	`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS ratings (
			id TEXT PRIMARY KEY,
			recipe_id TEXT NOT NULL,
			rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
			FOREIGN KEY (recipe_id) REFERENCES recipes(id)
		)
	`)
	if err != nil {
		return err
	}

	return nil
}

func addSecurityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'")
	c.Set("X-XSS-Protection", "1; mode=block")
	return c.Next()
}

func validateRecipeInput(title string, ingredients []string, instructions string) error {
	if strings.TrimSpace(title) == "" {
		return fmt.Errorf("title is required")
	}
	if len(title) > 200 {
		return fmt.Errorf("title too long")
	}
	if len(ingredients) == 0 {
		return fmt.Errorf("at least one ingredient is required")
	}
	for _, ing := range ingredients {
		if strings.TrimSpace(ing) == "" {
			return fmt.Errorf("ingredient cannot be empty")
		}
		if len(ing) > 200 {
			return fmt.Errorf("ingredient too long")
		}
	}
	if strings.TrimSpace(instructions) == "" {
		return fmt.Errorf("instructions are required")
	}
	if len(instructions) > 10000 {
		return fmt.Errorf("instructions too long")
	}
	return nil
}

func getRecipeByID(recipeID string) (*Recipe, error) {
	var recipe Recipe
	var ingredientsJSON string

	err := db.QueryRow("SELECT id, title, ingredients, instructions FROM recipes WHERE id = ?", recipeID).
		Scan(&recipe.ID, &recipe.Title, &ingredientsJSON, &recipe.Instructions)
	if err != nil {
		return nil, err
	}

	err = json.Unmarshal([]byte(ingredientsJSON), &recipe.Ingredients)
	if err != nil {
		return nil, err
	}

	recipe.Comments = []Comment{}
	rows, err := db.Query("SELECT comment FROM comments WHERE recipe_id = ?", recipeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var comment Comment
		if err := rows.Scan(&comment.Comment); err != nil {
			return nil, err
		}
		recipe.Comments = append(recipe.Comments, comment)
	}

	var avgRating sql.NullFloat64
	err = db.QueryRow("SELECT AVG(rating) FROM ratings WHERE recipe_id = ?", recipeID).Scan(&avgRating)
	if err != nil {
		return nil, err
	}
	if avgRating.Valid {
		recipe.AvgRating = &avgRating.Float64
	}

	return &recipe, nil
}

func getRecipesHandler(c *fiber.Ctx) error {
	rows, err := db.Query(`
		SELECT r.id, r.title, AVG(rt.rating) as avg_rating
		FROM recipes r
		LEFT JOIN ratings rt ON r.id = rt.recipe_id
		GROUP BY r.id
		ORDER BY avg_rating DESC, r.id DESC
		LIMIT 20
	`)
	if err != nil {
		log.Printf("Error querying recipes: %v", err)
		return c.Status(500).SendString("Internal server error")
	}
	defer rows.Close()

	var htmlBuilder strings.Builder
	htmlBuilder.WriteString(`<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<title>Recipe Overview</title>
</head>
<body>
	<h1>Recipe Overview</h1>
	<ul>
`)

	for rows.Next() {
		var id, title string
		var avgRating sql.NullFloat64
		if err := rows.Scan(&id, &title, &avgRating); err != nil {
			log.Printf("Error scanning recipe: %v", err)
			continue
		}

		escapedTitle := html.EscapeString(title)
		escapedID := html.EscapeString(id)

		ratingStr := "Not rated"
		if avgRating.Valid {
			ratingStr = fmt.Sprintf("%.1f/5", avgRating.Float64)
		}

		htmlBuilder.WriteString(fmt.Sprintf(
			`		<li><a href="/recipes/%s">%s</a> - %s</li>%s`,
			escapedID, escapedTitle, html.EscapeString(ratingStr), "\n",
		))
	}

	htmlBuilder.WriteString(`	</ul>
</body>
</html>`)

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.SendString(htmlBuilder.String())
}

func uploadRecipeHandler(c *fiber.Ctx) error {
	var input struct {
		Title        string   `json:"title"`
		Ingredients  []string `json:"ingredients"`
		Instructions string   `json:"instructions"`
	}

	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if err := validateRecipeInput(input.Title, input.Ingredients, input.Instructions); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	recipeID := uuid.New().String()

	ingredientsJSON, err := json.Marshal(input.Ingredients)
	if err != nil {
		log.Printf("Error marshaling ingredients: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	_, err = db.Exec(
		"INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)",
		recipeID, input.Title, string(ingredientsJSON), input.Instructions,
	)
	if err != nil {
		log.Printf("Error inserting recipe: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	recipe := Recipe{
		ID:           recipeID,
		Title:        input.Title,
		Ingredients:  input.Ingredients,
		Instructions: input.Instructions,
		Comments:     []Comment{},
		AvgRating:    nil,
	}

	return c.Status(201).JSON(recipe)
}

func getRecipeHandler(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	if _, err := uuid.Parse(recipeID); err != nil {
		return c.Status(404).SendString("Recipe not found")
	}

	recipe, err := getRecipeByID(recipeID)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).SendString("Recipe not found")
		}
		log.Printf("Error getting recipe: %v", err)
		return c.Status(500).SendString("Internal server error")
	}

	var htmlBuilder strings.Builder
	htmlBuilder.WriteString(`<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<title>Recipe Details</title>
</head>
<body>
`)

	htmlBuilder.WriteString(fmt.Sprintf("	<h1>%s</h1>\n", html.EscapeString(recipe.Title)))

	ratingStr := "Not rated yet"
	if recipe.AvgRating != nil {
		ratingStr = fmt.Sprintf("%.1f/5", *recipe.AvgRating)
	}
	htmlBuilder.WriteString(fmt.Sprintf("	<p><strong>Average Rating:</strong> %s</p>\n", html.EscapeString(ratingStr)))

	htmlBuilder.WriteString("	<h2>Ingredients</h2>\n	<ul>\n")
	for _, ing := range recipe.Ingredients {
		htmlBuilder.WriteString(fmt.Sprintf("		<li>%s</li>\n", html.EscapeString(ing)))
	}
	htmlBuilder.WriteString("	</ul>\n")

	htmlBuilder.WriteString("	<h2>Instructions</h2>\n")
	htmlBuilder.WriteString(fmt.Sprintf("	<p>%s</p>\n", html.EscapeString(recipe.Instructions)))

	htmlBuilder.WriteString("	<h2>Comments</h2>\n")
	if len(recipe.Comments) == 0 {
		htmlBuilder.WriteString("	<p>No comments yet.</p>\n")
	} else {
		htmlBuilder.WriteString("	<ul>\n")
		for _, comment := range recipe.Comments {
			htmlBuilder.WriteString(fmt.Sprintf("		<li>%s</li>\n", html.EscapeString(comment.Comment)))
		}
		htmlBuilder.WriteString("	</ul>\n")
	}

	htmlBuilder.WriteString("</body>\n</html>")

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.SendString(htmlBuilder.String())
}

func addCommentHandler(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	if _, err := uuid.Parse(recipeID); err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	var input struct {
		Comment string `json:"comment"`
	}

	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if strings.TrimSpace(input.Comment) == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if len(input.Comment) > 1000 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
	if err != nil {
		log.Printf("Error checking recipe existence: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	if !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	commentID := uuid.New().String()
	_, err = db.Exec(
		"INSERT INTO comments (id, recipe_id, comment) VALUES (?, ?, ?)",
		commentID, recipeID, input.Comment,
	)
	if err != nil {
		log.Printf("Error inserting comment: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Comment added successfully"})
}

func addRatingHandler(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	if _, err := uuid.Parse(recipeID); err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	var input struct {
		Rating int `json:"rating"`
	}

	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if input.Rating < 1 || input.Rating > 5 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
	if err != nil {
		log.Printf("Error checking recipe existence: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	if !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	ratingID := uuid.New().String()
	_, err = db.Exec(
		"INSERT INTO ratings (id, recipe_id, rating) VALUES (?, ?, ?)",
		ratingID, recipeID, input.Rating,
	)
	if err != nil {
		log.Printf("Error inserting rating: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Rating added successfully"})
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			log.Printf("Error: %v", err)
			return c.Status(code).JSON(fiber.Map{
				"error": "An error occurred",
			})
		},
	})

	app.Use(addSecurityHeaders)

	app.Get("/recipes", getRecipesHandler)
	app.Post("/recipes/upload", uploadRecipeHandler)
	app.Get("/recipes/:recipeId", getRecipeHandler)
	app.Post("/recipes/:recipeId/comments", addCommentHandler)
	app.Post("/recipes/:recipeId/ratings", addRatingHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}