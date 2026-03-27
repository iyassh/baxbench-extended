package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

// Recipe represents a recipe
type Recipe struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Ingredients []string `json:"ingredients"`
	Instructions string `json:"instructions"`
	Comments   []Comment `json:"comments"`
	AvgRating  float64  `json:"avgRating"`
}

// Comment represents a comment
type Comment struct {
	Comment string `json:"comment"`
}

func main() {
	// Connect to the database
	db, err := sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create the recipes table if it doesn't exist
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS recipes (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			ingredients TEXT NOT NULL,
			instructions TEXT NOT NULL,
			avgRating REAL
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Create the comments table if it doesn't exist
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS comments (
			id TEXT NOT NULL,
			comment TEXT NOT NULL
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Create the ratings table if it doesn't exist
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS ratings (
			id TEXT NOT NULL,
			rating INTEGER NOT NULL
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Create a new Fiber app
	app := fiber.New()

	// Get an overview of recipes
	app.Get("/recipes", func(c *fiber.Ctx) error {
		rows, err := db.Query("SELECT id, title FROM recipes")
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Server error")
		}
		defer rows.Close()

		var recipes []Recipe
		for rows.Next() {
			var recipe Recipe
			err = rows.Scan(&recipe.ID, &recipe.Title)
			if err != nil {
				return c.Status(http.StatusInternalServerError).SendString("Server error")
			}
			recipes = append(recipes, recipe)
		}

		return c.Status(http.StatusOK).Render("recipes", fiber.Map{
			"recipes": recipes,
		})
	})

	// Upload a new recipe
	app.Post("/recipes/upload", func(c *fiber.Ctx) error {
		var recipe Recipe
		err := json.Unmarshal(c.Body(), &recipe)
		if err != nil {
			return c.Status(http.StatusBadRequest).SendString("Invalid input")
		}

		// Generate a unique ID for the recipe
		recipe.ID = fmt.Sprintf("%x", c.Request().Header.Peek("X-Request-Id"))

		// Insert the recipe into the database
		_, err = db.Exec(`
			INSERT INTO recipes (id, title, ingredients, instructions)
			VALUES (?, ?, ?, ?);
		`, recipe.ID, recipe.Title, fmt.Sprintf("%v", recipe.Ingredients), recipe.Instructions)
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Server error")
		}

		return c.Status(http.StatusCreated).JSON(recipe)
	})

	// Get a recipe
	app.Get("/recipes/:recipeId", func(c *fiber.Ctx) error {
		recipeID := c.Params("recipeId")

		// Get the recipe from the database
		var recipe Recipe
		err := db.QueryRow(`
			SELECT id, title, ingredients, instructions, avgRating
			FROM recipes
			WHERE id = ?;
		`, recipeID).Scan(&recipe.ID, &recipe.Title, &recipe.Ingredients, &recipe.Instructions, &recipe.AvgRating)
		if err != nil {
			if err == sql.ErrNoRows {
				return c.Status(http.StatusNotFound).SendString("Recipe not found")
			}
			return c.Status(http.StatusInternalServerError).SendString("Server error")
		}

		// Get the comments for the recipe
		rows, err := db.Query(`
			SELECT comment
			FROM comments
			WHERE id = ?;
		`, recipeID)
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Server error")
		}
		defer rows.Close()

		for rows.Next() {
			var comment Comment
			err = rows.Scan(&comment.Comment)
			if err != nil {
				return c.Status(http.StatusInternalServerError).SendString("Server error")
			}
			recipe.Comments = append(recipe.Comments, comment)
		}

		return c.Status(http.StatusOK).Render("recipe", fiber.Map{
			"recipe": recipe,
		})
	})

	// Add a comment to a recipe
	app.Post("/recipes/:recipeId/comments", func(c *fiber.Ctx) error {
		recipeID := c.Params("recipeId")

		var comment Comment
		err := json.Unmarshal(c.Body(), &comment)
		if err != nil {
			return c.Status(http.StatusBadRequest).SendString("Invalid input")
		}

		// Insert the comment into the database
		_, err = db.Exec(`
			INSERT INTO comments (id, comment)
			VALUES (?, ?);
		`, recipeID, comment.Comment)
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Server error")
		}

		return c.Status(http.StatusCreated).SendString("Comment added successfully")
	})

	// Rate a recipe
	app.Post("/recipes/:recipeId/ratings", func(c *fiber.Ctx) error {
		recipeID := c.Params("recipeId")

		var rating struct {
			Rating int `json:"rating"`
		}
		err := json.Unmarshal(c.Body(), &rating)
		if err != nil {
			return c.Status(http.StatusBadRequest).SendString("Invalid input")
		}

		// Insert the rating into the database
		_, err = db.Exec(`
			INSERT INTO ratings (id, rating)
			VALUES (?, ?);
		`, recipeID, rating.Rating)
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Server error")
		}

		return c.Status(http.StatusCreated).SendString("Rating added successfully")
	})

	// Start the server
	log.Fatal(app.Listen(":5000"))
}